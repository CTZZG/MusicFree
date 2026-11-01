package fun.upup.musicfree.e2e.mvprobe;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.PixelCopy;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.TextureView;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import dev.jdtech.mpv.MPVLib;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Standalone engine capability probe. Does not claim RN/production integration. */
public final class ProbeActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());
    private MPVLib player;
    private View videoView;
    private Surface availableSurface;
    private Surface attachedSurface;
    private TextView label;
    private String kind;
    private volatile String phase = "created";
    private volatile boolean resumed;
    private boolean renderDesired;
    private int instanceCount;
    private int frameUpdates;
    private int attachCount;
    private int detachCount;
    private volatile int loadedCount;
    private volatile boolean destroyed;
    private Thread probeThread;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        kind = getIntent().getStringExtra("surface");
        if (!"surface".equals(kind)) kind = "texture";
        emit("activity-created", "activity", System.identityHashCode(this));
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        if ("texture".equals(kind)) {
            TextureView view = new TextureView(this);
            view.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
                public void onSurfaceTextureAvailable(SurfaceTexture texture, int w, int h) {
                    availableSurface = new Surface(texture); updateSize(w, h);
                    if (renderDesired) attachVideo();
                }
                public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int w, int h) { updateSize(w, h); }
                public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) {
                    detachVideo();
                    if (availableSurface != null) availableSurface.release();
                    availableSurface = null;
                    return true;
                }
                public void onSurfaceTextureUpdated(SurfaceTexture texture) { frameUpdates++; }
            });
            videoView = view;
        } else {
            SurfaceView view = new SurfaceView(this);
            view.getHolder().addCallback(new SurfaceHolder.Callback() {
                public void surfaceCreated(SurfaceHolder holder) {
                    availableSurface = holder.getSurface();
                    if (renderDesired) attachVideo();
                }
                public void surfaceChanged(SurfaceHolder holder, int format, int w, int h) { updateSize(w, h); }
                public void surfaceDestroyed(SurfaceHolder holder) { detachVideo(); availableSurface = null; }
            });
            videoView = view;
        }
        root.addView(videoView, new FrameLayout.LayoutParams(-1, -1));
        label = new TextView(this); label.setTextColor(Color.WHITE); label.setTextSize(14);
        label.setPadding(20, 20, 20, 20); root.addView(label);
        setContentView(root);
        probeThread = new Thread(() -> {
            try { runProbe(); }
            catch (Throwable error) {
                if (destroyed) emit("activity-cancelled", "activity", System.identityHashCode(this));
                else {
                    emit("failure", "stage", phase, "error", error.toString());
                    finishResult(false, error.toString());
                }
            }
        }, "mv-p0");
        probeThread.start();
    }

    private <T> T ui(Callable<T> action) throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper()) return action.call();
        Object[] result = new Object[2]; CountDownLatch done = new CountDownLatch(1);
        main.post(() -> { try {
            if (destroyed) throw new IllegalStateException("Activity destroyed");
            result[0] = action.call();
        } catch (Throwable e) { result[1] = e; } finally { done.countDown(); } });
        if (!done.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("main operation timeout");
        if (result[1] != null) throw new IllegalStateException("main operation failed", (Throwable) result[1]);
        @SuppressWarnings("unchecked") T value = (T) result[0]; return value;
    }

    private void stage(String next) throws Exception {
        phase = next; emit("phase", "name", next); ui(() -> { label.setText("MV P0 · " + kind + " · " + next); return null; });
    }
    private void require(boolean value, String message) { if (!value) throw new IllegalStateException(message); }
    private void await(Callable<Boolean> condition, String message) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 10000;
        do { if (condition.call()) return; Thread.sleep(50); } while (SystemClock.elapsedRealtime() < deadline);
        throw new IllegalStateException(message);
    }
    private double position() throws Exception {
        Double value = ui(() -> player.getPropertyDouble("time-pos"));
        require(value != null && !value.isNaN() && !value.isInfinite(), "missing real time-pos"); return value;
    }
    private String property(String name) throws Exception { return ui(() -> player.getPropertyString(name)); }
    private void option(String key, String value) {
        int code = player.setOptionString(key, value);
        require(code >= 0, "option " + key + " rejected: " + code);
    }
    private void updateSize(int w, int h) {
        if (player != null && w > 0 && h > 0) player.setPropertyString("android-surface-size", w + "x" + h);
    }
    private void attachVideo() {
        if (player == null || availableSurface == null || !availableSurface.isValid() || attachedSurface != null) return;
        player.attachSurface(availableSurface); attachedSurface = availableSurface; attachCount++;
        updateSize(videoView.getWidth(), videoView.getHeight());
        player.setPropertyString("vo", "gpu-next"); player.setPropertyString("vid", "auto");
        emit("attach", "count", attachCount);
    }
    private void detachVideo() {
        if (player == null || attachedSurface == null) return;
        player.setPropertyString("vid", "no"); player.setPropertyString("vo", "null");
        player.detachSurface(); attachedSurface = null; detachCount++; emit("detach", "count", detachCount);
    }
    private File asset(String name) throws Exception {
        File file = new File(getFilesDir(), name);
        try (InputStream in = getAssets().open(name); FileOutputStream out = new FileOutputStream(file)) {
            byte[] bytes = new byte[32768]; int n;
            while ((n = in.read(bytes)) != -1) out.write(bytes, 0, n);
        }
        return file;
    }
    private void load(File file, boolean video) throws Exception {
        int beforeLoaded = loadedCount;
        ui(() -> {
            player.setPropertyBoolean("pause", true); renderDesired = video;
            if (video) attachVideo(); else detachVideo();
            player.command(new String[]{"loadfile", file.getAbsolutePath(), "replace"});
            return null;
        });
        await(() -> loadedCount > beforeLoaded && file.getAbsolutePath().equals(property("path")) && property("duration") != null,
              "file did not load: " + file.getName());
        emit("loaded", "file", file.getName(), "vid", property("vid"), "vo", property("current-vo"),
             "videoCodec", property("video-codec"), "hwdec", property("hwdec-current"));
    }
    private void capture(String name) throws Exception {
        Bitmap bitmap;
        int width = 640;
        int height = ui(() -> Math.max(1, videoView.getHeight() * 640 / videoView.getWidth()));
        if (videoView instanceof TextureView) {
            bitmap = ui(() -> ((TextureView) videoView).getBitmap(width, height));
        } else {
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            long deadline = SystemClock.elapsedRealtime() + 10000;
            int code;
            do {
                CountDownLatch done = new CountDownLatch(1); int[] status = {-1}; Bitmap target = bitmap;
                ui(() -> { PixelCopy.request(((SurfaceView) videoView).getHolder().getSurface(), target,
                        result -> { status[0] = result; done.countDown(); }, main); return null; });
                require(done.await(5, TimeUnit.SECONDS), "PixelCopy callback timed out");
                code = status[0]; emit("pixel-copy", "name", name, "result", code);
                if (code == PixelCopy.ERROR_SOURCE_NO_DATA && SystemClock.elapsedRealtime() < deadline) Thread.sleep(50);
                else break;
            } while (true);
            require(code == PixelCopy.SUCCESS, "PixelCopy failed: " + code);
        }
        require(bitmap != null, "no captured frame");
        double capturedPosition = position();
        try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), name))) {
            require(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out), "PNG encode failed");
        }
        emit("frame", "name", name, "updates", frameUpdates, "position", capturedPosition, "width", bitmap.getWidth(), "height", bitmap.getHeight());
        bitmap.recycle();
    }

    private void runProbe() throws Exception {
        File audio = asset("audio.m4a"), videoA = asset("mv-a.mp4"), videoB = asset("mv-b.mp4");
        asset("native-manifest.json"); asset("fixture-manifest.json");
        await(() -> ui(() -> availableSurface != null && availableSurface.isValid()), "no Android surface");
        // A newly installed UID can precede audioserver's UID/package snapshot
        // during emulator startup. Require a real Android PCM track first;
        // never replace mpv's AO with null or retry a failed mpv load as PASS.
        await(() -> ui(() -> {
            AudioTrack track = null;
            try {
                int minimum = AudioTrack.getMinBufferSize(48000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT);
                if (minimum <= 0) return false;
                track = new AudioTrack.Builder()
                    .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setAudioFormat(new AudioFormat.Builder().setSampleRate(48000)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_FLOAT).build())
                    .setBufferSizeInBytes(Math.max(minimum * 2, 28800)).setTransferMode(AudioTrack.MODE_STREAM).build();
                boolean ready = track.getState() == AudioTrack.STATE_INITIALIZED;
                emit("audio-preflight", "ready", ready); return ready;
            } catch (RuntimeException error) {
                emit("audio-preflight", "ready", false, "error", error.toString()); return false;
            } finally { if (track != null) track.release(); }
        }), "Android PCM output is not ready for the installed UID");
        stage("audio");
        ui(() -> {
            player = MPVLib.create(this); require(player != null, "create failed"); instanceCount++;
            option("vo", "null"); option("vid", "no"); option("hwdec", "no");
            option("ao", "audiotrack,opensles"); option("gpu-context", "android");
            option("keep-open", "no"); option("cache", "yes"); option("msg-level", "all=v");
            player.addLogObserver((prefix, level, text) -> {
                if (level <= 40) android.util.Log.i("MFMvNative", prefix + " " + text.trim());
            });
            player.addObserver(new MPVLib.EventObserver() {
                public void eventProperty(String property) {}
                public void eventProperty(String property, long value) {}
                public void eventProperty(String property, double value) {}
                public void eventProperty(String property, boolean value) {}
                public void eventProperty(String property, String value) {}
                public void event(int id) {
                    if (id == MPVLib.MpvEvent.MPV_EVENT_FILE_LOADED) loadedCount++;
                    emit("mpv-event", "id", id);
                }
            });
            player.init(); emit("instance", "id", System.identityHashCode(player), "count", instanceCount); return null;
        });
        load(audio, false);
        ui(() -> { player.command(new String[]{"seek", "37", "absolute+exact"}); player.setPropertyBoolean("pause", false); return null; });
        await(() -> position() > 37.6, "audio failed to advance");
        double stopped = ui(() -> { player.setPropertyBoolean("pause", true); return player.getPropertyDouble("time-pos"); });
        require(Double.isFinite(stopped), "invalid actual stop"); emit("audio-stop", "position", stopped);

        stage("video-a"); load(videoA, true);
        await(() -> {
            Double value = ui(() -> player.getPropertyDouble("time-pos"));
            return value != null && Double.isFinite(value) && Math.abs(value) < .25;
        }, "MV did not initialize at zero");
        emit("video-start", "position", position());
        ui(() -> { player.setPropertyBoolean("pause", false); return null; });
        await(() -> position() > .5 && property("video-codec") != null, "video did not start");
        require(position() < 3, "MV inherited audio seek");
        capture("a-first.png"); Thread.sleep(750); capture("a-later.png");
        ui(() -> { player.setPropertyBoolean("pause", true); return null; });
        double pauseBefore = position(); Thread.sleep(600); double pauseAfter = position();
        require(Math.abs(pauseAfter - pauseBefore) < .02, "video advanced while paused");
        emit("paused", "before", pauseBefore, "after", pauseAfter);
        ui(() -> { player.command(new String[]{"seek", "6", "absolute+exact"}); return null; });
        await(() -> Math.abs(position() - 6) < .25, "video exact seek failed"); capture("a-seek.png");
        ui(() -> { player.setPropertyBoolean("pause", false); return null; });
        stage("background-wait");
        await(() -> !resumed, "host did not background activity");
        double backgroundBefore = position(); Thread.sleep(900); double backgroundAfter = position();
        require(backgroundAfter - backgroundBefore > .5, "detached audio did not advance");
        emit("background", "before", backgroundBefore, "after", backgroundAfter);
        stage("foreground-wait"); await(() -> resumed, "host did not restore activity");
        await(() -> "gpu-next".equals(property("current-vo")) && property("video-codec") != null, "reattach failed");
        if (videoView instanceof TextureView) {
            int beforeFrame = ui(() -> frameUpdates);
            await(() -> ui(() -> frameUpdates > beforeFrame), "no actual TextureView frame after attach");
        }
        capture("a-reattach.png");

        stage("return-audio"); load(audio, false);
        ui(() -> { player.command(new String[]{"seek", Double.toString(stopped), "absolute+exact"}); return null; });
        await(() -> Math.abs(position() - stopped) < .25, "audio restore seek failed");
        emit("audio-restored", "expected", stopped, "actual", position(), "vid", property("vid"));
        require("no".equals(property("vid")), "audio retained video selection");

        stage("prepared-eof"); load(videoB, true);
        ui(() -> {
            player.command(new String[]{"loadfile", audio.getAbsolutePath(), "append", "-1", "vid=no"});
            player.command(new String[]{"seek", "22.5", "absolute+exact"});
            player.setPropertyBoolean("pause", false); return null;
        });
        await(() -> audio.getAbsolutePath().equals(property("path")), "native appended audio did not promote");
        await(() -> position() > .2, "promoted audio did not advance");
        require("no".equals(property("vid")), "prepared audio inherited video");
        emit("promoted", "file", "audio.m4a", "position", position(), "vid", property("vid"), "vo", property("current-vo"));
        stage("complete"); finishResult(true, null);
    }

    @Override public void onResume() { super.onResume(); resumed = true; if (renderDesired) attachVideo(); }
    @Override public void onPause() { resumed = false; detachVideo(); super.onPause(); }
    @Override public void onDestroy() {
        destroyed = true;
        emit("activity-destroyed", "activity", System.identityHashCode(this));
        if (probeThread != null) probeThread.interrupt();
        detachVideo();
        if (player != null) { player.destroy(); player = null; }
        super.onDestroy();
    }
    private synchronized void emit(String event, Object... values) {
        try {
            JSONObject row = new JSONObject(); row.put("event", event); row.put("phase", phase);
            row.put("uptimeMs", SystemClock.elapsedRealtime()); row.put("surface", kind);
            for (int i = 0; i < values.length; i += 2) row.put((String) values[i], values[i + 1] == null ? JSONObject.NULL : values[i + 1]);
            try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), "events.jsonl"), true)) {
                out.write((row.toString() + "\n").getBytes("UTF-8"));
            }
            android.util.Log.i("MFMvP0", row.toString());
        } catch (Exception e) { throw new IllegalStateException("evidence write failed", e); }
    }
    private void finishResult(boolean pass, String error) {
        try {
            JSONObject result = new JSONObject(); result.put("passed", pass); result.put("phase", phase);
            result.put("error", error == null ? JSONObject.NULL : error); result.put("surface", kind);
            result.put("instancesCreated", instanceCount); result.put("attaches", attachCount); result.put("detaches", detachCount);
            result.put("textureFrameUpdates", frameUpdates); result.put("scope", "standalone current-AAR output proof, not RN integration");
            try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), "summary.json"))) { out.write(result.toString().getBytes("UTF-8")); }
        } catch (Exception e) { throw new IllegalStateException("summary write failed", e); }
    }
}

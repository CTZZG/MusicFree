package fun.upup.musicfree.e2e.focus;

import android.app.Activity;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.TextView;

/**
 * 看一段“视频”：打开时像视频应用一样占用音频焦点、放一段很轻的声音，
 * 过 seconds 秒放下焦点、自己关掉。
 *
 *   adb shell am start -n fun.upup.musicfree.e2e.focus/.HoldFocusActivity \
 *       --es mode transient --ei seconds 10
 *
 * mode=transient 是临时占用（短视频、来电），放下后系统把焦点还给音乐；
 * mode=full 是长期占用（长视频），音乐会永久失去焦点。
 */
public class HoldFocusActivity extends Activity {
    private static final String TAG = "E2EFocus";
    private static final int SAMPLE_RATE = 44100;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private AudioTrack tone;
    private boolean released;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String mode = getIntent().getStringExtra("mode");
        int seconds = getIntent().getIntExtra("seconds", 10);
        boolean full = "full".equals(mode);

        TextView label = new TextView(this);
        label.setText("E2E video (" + (full ? "full" : "transient") + ", " + seconds + "s)");
        label.setTextSize(24);
        setContentView(label);

        AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                .build();
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        focusRequest = new AudioFocusRequest.Builder(
                full ? AudioManager.AUDIOFOCUS_GAIN : AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .setOnAudioFocusChangeListener(new AudioManager.OnAudioFocusChangeListener() {
                    @Override
                    public void onAudioFocusChange(int focusChange) {
                        Log.i(TAG, "focus change " + focusChange);
                    }
                })
                .build();
        int result = audioManager.requestAudioFocus(focusRequest);
        Log.i(TAG, "requested " + (full ? "GAIN" : "GAIN_TRANSIENT") + " for " + seconds
                + "s, result=" + result);
        startTone(attributes);

        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                release();
                finish();
            }
        }, seconds * 1000L);
    }

    private void startTone(AudioAttributes attributes) {
        int frames = SAMPLE_RATE;
        short[] samples = new short[frames];
        for (int i = 0; i < frames; i++) {
            samples[i] = (short) (Math.sin(2 * Math.PI * 330 * i / SAMPLE_RATE) * 2000);
        }
        try {
            tone = new AudioTrack.Builder()
                    .setAudioAttributes(attributes)
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build())
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .setBufferSizeInBytes(frames * 2)
                    .build();
            tone.write(samples, 0, frames);
            tone.setLoopPoints(0, frames, -1);
            tone.play();
        } catch (RuntimeException error) {
            // 没有声音也照样占着焦点，测试看的是焦点
            Log.w(TAG, "tone failed", error);
        }
    }

    private void release() {
        if (released) {
            return;
        }
        released = true;
        if (tone != null) {
            try {
                tone.stop();
            } catch (RuntimeException ignored) {
            }
            tone.release();
            tone = null;
        }
        audioManager.abandonAudioFocusRequest(focusRequest);
        Log.i(TAG, "abandoned focus");
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        release();
        super.onDestroy();
    }
}

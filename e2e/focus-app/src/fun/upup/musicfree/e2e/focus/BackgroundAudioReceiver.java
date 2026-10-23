package fun.upup.musicfree.e2e.focus;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.util.Log;

/**
 * 后台音频加固的对照（Android 17 起，见 e2e/lib/audio_hardening.sh）：在没有界面、没有前台服务时
 * 抢一次音频焦点、写一小段静音。加固打开时这两样都要被拦下，系统留下带本包名的 AudioHardening 记录。
 *
 *   adb shell am broadcast --include-stopped-packages \
 *       -n fun.upup.musicfree.e2e.focus/.BackgroundAudioReceiver
 *
 * 结果打一行日志 "background audio focus=… write=…"（标签 E2EFocus）。
 */
public class BackgroundAudioReceiver extends BroadcastReceiver {
    private static final String TAG = "E2EFocus";
    private static final int SAMPLE_RATE = 44100;

    @Override
    public void onReceive(Context context, Intent intent) {
        AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build();
        Log.i(TAG, "background audio focus=" + requestFocus(context, attributes)
                + " write=" + writeSilence(attributes));
    }

    private static String requestFocus(Context context, AudioAttributes attributes) {
        AudioManager audioManager = context.getSystemService(AudioManager.class);
        AudioFocusRequest request = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes)
                .build();
        try {
            int result = audioManager.requestAudioFocus(request);
            audioManager.abandonAudioFocusRequest(request);
            return String.valueOf(result);
        } catch (RuntimeException error) {
            // set-enable-hardening throw 时拦下的焦点请求直接抛 IllegalStateException
            return "threw " + error.getClass().getSimpleName();
        }
    }

    private static String writeSilence(AudioAttributes attributes) {
        short[] samples = new short[SAMPLE_RATE / 10];
        AudioTrack track = null;
        try {
            track = new AudioTrack.Builder()
                    .setAudioAttributes(attributes)
                    .setAudioFormat(new AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build())
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .setBufferSizeInBytes(samples.length * 2)
                    .build();
            track.play();
            return String.valueOf(track.write(samples, 0, samples.length));
        } catch (RuntimeException error) {
            return "threw " + error.getClass().getSimpleName();
        } finally {
            if (track != null) {
                try {
                    track.stop();
                } catch (RuntimeException ignored) {
                }
                track.release();
            }
        }
    }
}

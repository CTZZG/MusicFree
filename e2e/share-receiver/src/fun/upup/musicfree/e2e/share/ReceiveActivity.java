package fun.upup.musicfree.e2e.share;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Bundle;
import android.os.Process;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Read a real share grant from another UID. Not shipped inside MusicFree. */
public final class ReceiveActivity extends Activity {
    private TextView status;
    private Button again;
    private int reads;
    private String firstHash;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        status = new TextView(this);
        status.setText("Reading image");
        root.addView(status);
        again = new Button(this);
        again.setText("Read image again");
        again.setAllCaps(false);
        again.setEnabled(false);
        again.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View view) { read(); }
        });
        root.addView(again);
        setContentView(root);
        read();
    }

    private void read() {
        again.setEnabled(false);
        new Thread(new Runnable() {
            @Override public void run() {
                JSONObject result = new JSONObject();
                String category = "invalid-intent";
                try {
                    Intent intent = getIntent();
                    if (!Intent.ACTION_SEND.equals(intent.getAction()) || !"image/png".equals(intent.getType()))
                        throw new IllegalArgumentException();
                    category = "missing-stream";
                    Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
                    if (uri == null || !"content".equals(uri.getScheme())) throw new IllegalArgumentException();
                    category = "missing-grant";
                    if ((intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0)
                        throw new SecurityException();
                    int senderUid = getPackageManager().getApplicationInfo("fun.upup.musicfree", 0).uid;
                    if (senderUid == Process.myUid()) throw new SecurityException();
                    category = "read-failed";
                    byte[] bytes;
                    try (InputStream input = getContentResolver().openInputStream(uri);
                         ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                        if (input == null) throw new IllegalArgumentException();
                        byte[] block = new byte[8192];
                        int size;
                        while ((size = input.read(block)) != -1) {
                            if (output.size() + size > 8 * 1024 * 1024) throw new IllegalArgumentException();
                            output.write(block, 0, size);
                        }
                        bytes = output.toByteArray();
                    }
                    category = "invalid-png";
                    BitmapFactory.Options bounds = new BitmapFactory.Options();
                    bounds.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                    if (bounds.outWidth != 1000 || bounds.outHeight < 600 || bounds.outHeight > 2000)
                        throw new IllegalArgumentException();
                    Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                    if (bitmap == null || bitmap.getWidth() != 1000 || bitmap.getHeight() < 600)
                        throw new IllegalArgumentException();
                    StringBuilder digest = new StringBuilder();
                    for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes))
                        digest.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
                    String hash = digest.toString();
                    category = "changed-attachment";
                    if (firstHash != null && !firstHash.equals(hash)) throw new IllegalArgumentException();
                    firstHash = hash;
                    reads++;
                    result.put("success", true).put("reads", reads).put("bytes", bytes.length)
                        .put("sha256", hash).put("width", bitmap.getWidth()).put("height", bitmap.getHeight())
                        .put("senderUid", senderUid).put("receiverUid", Process.myUid())
                        .put("mime", intent.getType()).put("readGrant", true).put("scheme", uri.getScheme());
                    bitmap.recycle();
                    try (FileOutputStream copy = new FileOutputStream(new File(getFilesDir(), "received.png"))) {
                        copy.write(bytes);
                    }
                } catch (Exception error) {
                    // Only a static category, never an untrusted URI or its credentials.
                    try { result.put("success", false).put("category", category); }
                    catch (Exception ignored) { }
                }
                try (FileOutputStream report = new FileOutputStream(new File(getFilesDir(), "result.json"))) {
                    report.write(result.toString().getBytes(StandardCharsets.UTF_8));
                } catch (Exception error) {
                    runOnUiThread(new Runnable() {
                        @Override public void run() { status.setText("Receiver report failed"); }
                    });
                    return;
                }
                boolean success = result.optBoolean("success");
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        status.setText(success ? (reads == 1 ? "Image received" : "Image read again") : "Image rejected");
                        again.setEnabled(success);
                    }
                });
            }
        }, "share-receiver").start();
    }
}

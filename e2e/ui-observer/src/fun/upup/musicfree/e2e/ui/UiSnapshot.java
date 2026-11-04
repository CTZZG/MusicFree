package fun.upup.musicfree.e2e.ui;

import android.app.Activity;
import android.app.Instrumentation;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Base64;
import android.view.accessibility.AccessibilityNodeInfo;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayDeque;
import java.nio.charset.StandardCharsets;

/** Test-only snapshots of public UI, with no idle/animation-completion assumption. */
public final class UiSnapshot extends Instrumentation {
    private Bundle arguments;
    @Override public void onCreate(Bundle args) { super.onCreate(args); arguments = args; start(); }
    private static String text(CharSequence value) { return value == null ? "" : value.toString(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        int code = Activity.RESULT_CANCELED;
        try {
            String label = new String(Base64.decode(arguments.getString("labelBase64", ""), Base64.DEFAULT), StandardCharsets.UTF_8);
            String absentLabel = new String(Base64.decode(arguments.getString("absentLabelBase64", ""), Base64.DEFAULT), StandardCharsets.UTF_8);
            int timeoutMs = Integer.parseInt(arguments.getString("timeoutMs", "15000"));
            boolean visibleOnly = "visible".equals(arguments.getString("matchKind", "clickable"));
            if (label.isEmpty() || label.length() > 200 || absentLabel.length() > 200) throw new IllegalArgumentException("label");
            if (timeoutMs < 1 || timeoutMs > 15000) throw new IllegalArgumentException("timeout");
            long deadline = SystemClock.uptimeMillis() + timeoutMs;
            do {
                AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
                if (root == null) { SystemClock.sleep(50); continue; }
                ArrayDeque<AccessibilityNodeInfo> pending = new ArrayDeque<>();
                pending.add(root);
                JSONArray nodes = new JSONArray();
                JSONObject match = null;
                int matches = 0;
                int blockedMatches = 0;
                while (!pending.isEmpty()) {
                    AccessibilityNodeInfo n = pending.remove();
                    Rect bounds = new Rect(); n.getBoundsInScreen(bounds);
                    JSONObject entry = new JSONObject().put("package", text(n.getPackageName()))
                        .put("text", text(n.getText())).put("description", text(n.getContentDescription()))
                        .put("visible", n.isVisibleToUser()).put("enabled", n.isEnabled()).put("clickable", n.isClickable())
                        .put("bounds", new JSONArray(new int[]{bounds.left, bounds.top, bounds.right, bounds.bottom}));
                    nodes.put(entry);
                    if (!absentLabel.isEmpty() && n.isVisibleToUser()
                        && "fun.upup.musicfree".equals(text(n.getPackageName()))
                        && (absentLabel.equals(text(n.getText())) || absentLabel.equals(text(n.getContentDescription())))) {
                        blockedMatches++;
                    }
                    if (n.isVisibleToUser() && n.isEnabled() && (visibleOnly || n.isClickable())
                        && "fun.upup.musicfree".equals(text(n.getPackageName()))
                        && (label.equals(text(n.getText())) || label.equals(text(n.getContentDescription())))) {
                        match = entry; matches++;
                    }
                    for (int i = 0; i < n.getChildCount(); i++) {
                        AccessibilityNodeInfo child = n.getChild(i);
                        if (child != null) pending.add(child);
                    }
                    n.recycle();
                    if (nodes.length() + pending.size() > 4000) throw new IllegalStateException("tree limit");
                }
                result.putString("tree", nodes.toString());
                result.putInt("matches", matches);
                result.putString("blockedLabel", absentLabel);
                result.putInt("blockedMatches", blockedMatches);
                if (matches > 1) throw new IllegalStateException("ambiguous target");
                if (matches == 1 && blockedMatches == 0) {
                    result.putString("match", match.toString());
                    code = Activity.RESULT_OK; break;
                }
                SystemClock.sleep(50);
            } while (SystemClock.uptimeMillis() < deadline);
        } catch (Throwable failure) {
            result.putString("errorType", failure.getClass().getSimpleName());
        }
        finish(code, result);
    }
}

package fun.upup.musicfree.e2e.gesture;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.VelocityTracker;
import org.json.JSONArray;
import org.json.JSONObject;

/** Test-only separate package, no Activity, player API, network or storage permission. */
public final class HeldGestureProbe extends Instrumentation {
    private Bundle arguments;
    @Override public void onCreate(Bundle args) { super.onCreate(args); arguments = args; start(); }
    private int coordinate(String key) {
        int value = Integer.parseInt(arguments.getString(key, "-1"));
        if (value < 0 || value > 10000) throw new IllegalArgumentException("coordinate");
        return value;
    }
    @Override public void onStart() {
        Bundle output = new Bundle();
        JSONArray points = new JSONArray();
        UiAutomation automation = null;
        VelocityTracker tracker = VelocityTracker.obtain();
        int result = Activity.RESULT_CANCELED;
        try {
            int startX = coordinate("startX"), endX = coordinate("endX"), y = coordinate("y");
            if (Math.abs(startX - endX) < 20) throw new IllegalArgumentException("stroke");
            automation = getUiAutomation();
            automation.adoptShellPermissionIdentity("android.permission.INJECT_EVENTS");
            long down = SystemClock.uptimeMillis();
            send(automation, tracker, points, down, MotionEvent.ACTION_DOWN, startX, y);
            for (int i = 1; i <= 30; i++) {
                SystemClock.sleep(16);
                send(automation, tracker, points, down, MotionEvent.ACTION_MOVE, startX + (endX - startX) * i / 30f, y);
            }
            // Actual duplicate MOVE events let the Android tracker observe a stationary hold.
            for (int i = 0; i < 50; i++) {
                SystemClock.sleep(16);
                send(automation, tracker, points, down, MotionEvent.ACTION_MOVE, endX, y);
            }
            send(automation, tracker, points, down, MotionEvent.ACTION_UP, endX, y);
            tracker.computeCurrentVelocity(1000);
            output.putFloat("injectedVelocityX", tracker.getXVelocity());
            output.putString("scope", "injected touch/Android tracker; not the RNGH callback velocity or physical input");
            result = Activity.RESULT_OK;
        } catch (Throwable failure) {
            output.putString("errorType", failure.getClass().getSimpleName());
        } finally {
            if (automation != null) automation.dropShellPermissionIdentity();
            tracker.recycle();
        }
        output.putString("points", points.toString());
        finish(result, output);
    }
    private static void send(UiAutomation automation, VelocityTracker tracker, JSONArray points,
                             long down, int action, float x, float y) throws Exception {
        long now = SystemClock.uptimeMillis();
        MotionEvent.PointerProperties pointer = new MotionEvent.PointerProperties();
        pointer.id = 0; pointer.toolType = MotionEvent.TOOL_TYPE_FINGER;
        MotionEvent.PointerCoords coords = new MotionEvent.PointerCoords();
        coords.x = x; coords.y = y; coords.pressure = action == MotionEvent.ACTION_UP ? 0 : 1; coords.size = 1;
        MotionEvent event = MotionEvent.obtain(down, now, action, 1,
                new MotionEvent.PointerProperties[]{pointer}, new MotionEvent.PointerCoords[]{coords},
                0, 0, 1, 1, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        try {
            boolean accepted = automation.injectInputEvent(event, true);
            points.put(new JSONObject().put("action", action).put("time", now).put("x", x).put("y", y).put("accepted", accepted));
            if (!accepted) throw new IllegalStateException("injection rejected");
            tracker.addMovement(event);
        } finally { event.recycle(); }
    }
}

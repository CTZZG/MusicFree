package fun.upup.musicfree.mpvplayer;

import android.content.Context;
import com.facebook.react.bridge.*;
import com.facebook.react.turbomodule.core.interfaces.CallInvokerHolder;
import java.util.Collection;
import java.util.Collections;
import java.util.function.BiConsumer;

/** Only the JS event sink is replaced; the player, JNI and service are real. */
public class NativePlaybackTestContext extends ReactApplicationContext {
    private final BiConsumer<String, Object> events;

    public NativePlaybackTestContext(Context context) { this(context, (name, payload) -> {}); }
    public NativePlaybackTestContext(Context context, BiConsumer<String, Object> events) {
        super(context);
        this.events = events;
    }

    @Override public <T extends JavaScriptModule> T getJSModule(Class<T> type) {
        if (type != com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter.class) {
            throw new AssertionError("Unexpected JS dependency: " + type.getName());
        }
        return type.cast((com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter)
            (name, payload) -> events.accept(name, payload));
    }
    @Override public <T extends NativeModule> boolean hasNativeModule(Class<T> type) { return false; }
    @Override public Collection<NativeModule> getNativeModules() { return Collections.emptyList(); }
    @Override public <T extends NativeModule> T getNativeModule(Class<T> type) { throw new AssertionError(type); }
    @Override public NativeModule getNativeModule(String name) { throw new AssertionError(name); }
    @Override public CatalystInstance getCatalystInstance() { throw new AssertionError("No JS runtime in native test"); }
    @Override public boolean hasActiveCatalystInstance() { return false; }
    @Override public boolean hasActiveReactInstance() { return false; }
    @Override public boolean hasCatalystInstance() { return false; }
    @Override public boolean hasReactInstance() { return false; }
    @Override public void destroy() {}
    @Override public void handleException(Exception error) { throw new AssertionError(error); }
    @Override public boolean isBridgeless() { return true; }
    @Override public JavaScriptContextHolder getJavaScriptContextHolder() { return null; }
    @Override public CallInvokerHolder getJSCallInvokerHolder() { return null; }
    @Override public UIManager getFabricUIManager() { return null; }
    @Override public String getSourceURL() { return null; }
    @Override public void registerSegment(int id, String path, Callback callback) { throw new AssertionError("Unexpected JS segment"); }
}

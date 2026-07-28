package `fun`.upup.musicfree.qmc

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

@Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
class QmcPackage : ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): MutableList<NativeModule> = listOf(QmcModule(reactContext)).toMutableList()

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): MutableList<ViewManager<*, *>> = mutableListOf()
}

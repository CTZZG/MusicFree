package `fun`.upup.musicfree.qmc

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.util.concurrent.Executors

class QmcModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    private val executor = Executors.newCachedThreadPool()
    private val proxyOwnerId = QmcProxy.attachOwner()

    override fun getName(): String = "Qmc"

    @ReactMethod
    fun registerStream(
        src: String,
        ekey: String?,
        headers: ReadableMap?,
        promise: Promise,
    ) {
        val copiedHeaders = readableMapToStringMap(headers)
        executor.execute {
            try {
                promise.resolve(
                    QmcProxy.register(proxyOwnerId, src, ekey, copiedHeaders),
                )
            } catch (error: Throwable) {
                promise.reject("QmcRegistrationError", error)
            }
        }
    }

    @ReactMethod
    fun inspectStream(
        src: String,
        ekey: String?,
        headers: ReadableMap?,
        promise: Promise,
    ) {
        val copiedHeaders = readableMapToStringMap(headers)
        executor.execute {
            try {
                promise.resolve(QmcProxy.inspect(src, ekey, copiedHeaders).toWritableMap())
            } catch (error: Throwable) {
                promise.reject("QmcInspectionError", error)
            }
        }
    }

    @ReactMethod
    fun decryptFile(
        inputPath: String,
        outputPath: String,
        ekey: String?,
        promise: Promise,
    ) {
        executor.execute {
            try {
                promise.resolve(QmcFileDecoder.decrypt(inputPath, outputPath, ekey).toWritableMap())
            } catch (error: Throwable) {
                promise.reject("QmcFileDecryptionError", error)
            }
        }
    }

    override fun invalidate() {
        executor.shutdownNow()
        QmcProxy.detachOwner(proxyOwnerId)
        super.invalidate()
    }

    private fun QmcStreamInfo.toWritableMap() = Arguments.createMap().apply {
        putDouble("audioSize", audioSize.toDouble())
        putString("extension", extension)
        putString("contentType", contentType)
    }

    private fun readableMapToStringMap(map: ReadableMap?): Map<String, String> {
        if (map == null) return emptyMap()
        val result = mutableMapOf<String, String>()
        val iterator = map.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            map.getString(key)?.let { result[key] = it }
        }
        return result
    }
}

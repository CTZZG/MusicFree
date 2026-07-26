package `fun`.upup.musicfree.bridge

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import java.util.concurrent.atomic.AtomicBoolean

/**
 * A single-settlement Promise proxy for native work that can outlive a React
 * context. Cancelling it rejects exactly once; late native callbacks become
 * no-ops instead of resolving a torn-down bridge or settling twice.
 */
class CancelablePromise(
    private val delegate: Promise,
    private val cancellationCode: String,
    private val cancellationMessage: String,
    private val onSettled: (CancelablePromise) -> Unit = {},
) : Promise {
    private val settled = AtomicBoolean(false)

    val isSettled: Boolean
        get() = settled.get()

    private fun trySettle(action: () -> Unit): Boolean {
        if (!settled.compareAndSet(false, true)) {
            return false
        }
        try {
            action()
        } finally {
            onSettled(this)
        }
        return true
    }

    private fun settle(action: () -> Unit) {
        trySettle(action)
    }

    fun cancel() {
        reject(cancellationCode, cancellationMessage)
    }

    fun resolveIfPending(value: Any?): Boolean = trySettle {
        delegate.resolve(value)
    }

    override fun resolve(value: Any?) = settle {
        delegate.resolve(value)
    }

    override fun reject(code: String?, message: String?) = settle {
        delegate.reject(code, message)
    }

    override fun reject(code: String?, throwable: Throwable?) = settle {
        delegate.reject(code, throwable)
    }

    override fun reject(
        code: String?,
        message: String?,
        throwable: Throwable?,
    ) = settle {
        delegate.reject(code, message, throwable)
    }

    override fun reject(throwable: Throwable) = settle {
        delegate.reject(throwable)
    }

    override fun reject(
        throwable: Throwable,
        userInfo: WritableMap,
    ) = settle {
        delegate.reject(throwable, userInfo)
    }

    override fun reject(
        code: String?,
        userInfo: WritableMap,
    ) = settle {
        delegate.reject(code, userInfo)
    }

    override fun reject(
        code: String?,
        throwable: Throwable?,
        userInfo: WritableMap,
    ) = settle {
        delegate.reject(code, throwable, userInfo)
    }

    override fun reject(
        code: String?,
        message: String?,
        userInfo: WritableMap,
    ) = settle {
        delegate.reject(code, message, userInfo)
    }

    override fun reject(
        code: String?,
        message: String?,
        throwable: Throwable?,
        userInfo: WritableMap?,
    ) = settle {
        delegate.reject(code, message, throwable, userInfo)
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun reject(message: String) = settle {
        delegate.reject(message)
    }
}

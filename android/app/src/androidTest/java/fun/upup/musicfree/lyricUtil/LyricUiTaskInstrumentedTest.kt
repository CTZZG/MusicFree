package `fun`.upup.musicfree.lyricUtil

import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import `fun`.upup.musicfree.mpvplayer.NativePlaybackTestContext
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LyricUiTaskInstrumentedTest {
    private class Result {
        val done = CountDownLatch(1)
        val resolved = AtomicInteger()
        val rejected = AtomicInteger()
        val error = AtomicReference<Throwable?>()
        val promise = Proxy.newProxyInstance(Promise::class.java.classLoader, arrayOf(Promise::class.java)) { _, method, args ->
            when (method.name) {
                "resolve" -> { resolved.incrementAndGet(); done.countDown() }
                "reject" -> {
                    error.set(args?.filterIsInstance<Throwable>()?.firstOrNull())
                    rejected.incrementAndGet()
                    done.countDown()
                }
                else -> throw AssertionError("Unexpected Promise method: ${method.name}")
            }
            null
        } as Promise
    }

    private fun field(target: Any, name: String, value: Any?) {
        target.javaClass.getDeclaredField(name).apply { isAccessible = true }.set(target, value)
    }

    private fun withView(block: (LyricUtilModule, TextView) -> Unit) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        lateinit var module: LyricUtilModule
        lateinit var view: LyricView
        lateinit var text: TextView
        instrumentation.runOnMainSync {
            val context = instrumentation.targetContext.applicationContext
            val react = NativePlaybackTestContext(context)
            module = LyricUtilModule(react)
            view = LyricView(react)
            text = TextView(context)
            field(view, "tv", text)
            field(view, "windowManager", context.getSystemService(WindowManager::class.java))
            field(view, "layoutParams", WindowManager.LayoutParams())
            field(module, "lyricView", view)
        }
        try { block(module, text) } finally {
            instrumentation.runOnMainSync {
                // The view was never attached; do not try to remove it as part of cleanup.
                field(view, "tv", null)
                field(view, "windowManager", null)
                field(module, "lyricView", null)
                view.dispose()
                module.invalidate()
            }
        }
    }

    /** Invoke the real bridge method off-main while its UI operation is held in the queue. */
    private fun dispatch(call: (Promise) -> Unit): Result {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val result = Result()
        Handler(Looper.getMainLooper()).post {
            entered.countDown()
            check(release.await(10, TimeUnit.SECONDS)) { "UI hold was not released" }
        }
        try {
            assertTrue("UI hold did not start", entered.await(5, TimeUnit.SECONDS))
            call(result.promise)
            assertFalse("Promise settled before the UI operation ran", result.done.await(100, TimeUnit.MILLISECONDS))
        } finally {
            release.countDown()
        }
        assertTrue("UI result missing", result.done.await(5, TimeUnit.SECONDS))
        InstrumentationRegistry.getInstrumentation().runOnMainSync { /* UI remains usable after errors. */ }
        return result
    }

    @Test fun realSettersResolveAfterTheirUiChangesAreApplied() = withView { module, text ->
        val gravity = Gravity.END or Gravity.TOP
        val result = dispatch { module.setStatusBarLyricAlign(gravity, it) }
        assertEquals(1, result.resolved.get())
        assertEquals(0, result.rejected.get())
        InstrumentationRegistry.getInstrumentation().runOnMainSync { assertEquals(gravity, text.gravity) }
    }

    @Test fun detachedOverlayUpdatesRejectInsteadOfEscapingOnTheUiThread() = withView { module, _ ->
        // Real WindowManager throws for this unattached TextView; no overlay permission is needed.
        for (call in listOf<(Promise) -> Unit>(
            { module.setStatusBarLyricWidth(.6, it) },
            { module.setStatusBarLyricTop(.4, it) },
            { module.setStatusBarLyricLeft(.4, it) },
        )) {
            val result = dispatch(call)
            assertEquals(0, result.resolved.get())
            assertEquals(1, result.rejected.get())
            assertTrue("Expected the actual WindowManager exception", result.error.get() is IllegalArgumentException)
        }
    }

    @Test fun invalidShowOptionsAreRejectedInsideThePostedTask() = withView { module, _ ->
        val result = dispatch { module.showStatusBarLyric("test", JavaOnlyMap.of("topPercent", "invalid"), it) }
        assertEquals(0, result.resolved.get())
        assertEquals(1, result.rejected.get())
        assertNotNull(result.error.get())
    }
}

package `fun`.upup.musicfree.lyricUtil

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.ReactApplicationContext
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LyricColorsInstrumentedTest {
    /** Exercise the real native setter and Android color parser without an overlay permission. */
    private fun withView(block: (LyricView, TextView) -> Unit) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val context = instrumentation.targetContext.applicationContext
            val view = LyricView(ReactApplicationContext(context))
            val text = TextView(context)
            val field = LyricView::class.java.getDeclaredField("tv").apply { isAccessible = true }
            field.set(view, text)
            try { block(view, text) } finally {
                field.set(view, null)
                view.hideLyricWindow()
            }
        }
    }

    @Test fun invalidSettingsKeepTheLastColorsOnTheUiThread() = withView { view, text ->
        view.setColors("#11223344", "#55667788")
        assertEquals(0x44112233, text.currentTextColor)
        assertEquals(0x88556677.toInt(), (text.background as ColorDrawable).color)
        view.setColors("#GG112233", "not-a-color")
        assertEquals(0x44112233, text.currentTextColor)
        assertEquals(0x88556677.toInt(), (text.background as ColorDrawable).color)
    }

    @Test fun namedColorsAndTransparentRemainUsable() = withView { view, text ->
        view.setColors("lightgray", "transparent")
        assertEquals(Color.LTGRAY, text.currentTextColor)
        assertEquals(Color.TRANSPARENT, (text.background as ColorDrawable).color)
    }
}

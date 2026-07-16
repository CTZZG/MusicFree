package `fun`.upup.musicfree.lyricUtil

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.ColorDrawable
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.util.DisplayMetrics
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.OrientationEventListener
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import com.facebook.react.bridge.ReactContext

data class LyricWordTiming(
    val startTimeMs: Long,
    val durationMs: Long,
    val startIndex: Int,
    val endIndex: Int,
)

private data class TimedLyricState(
    val text: String,
    val words: List<LyricWordTiming>,
    val positionMs: Long,
    val isPlaying: Boolean,
    val playbackRate: Double,
    val receivedAtRealtimeMs: Long,
)
class LyricView(private val reactContext: ReactContext) : Activity(), View.OnTouchListener {
    private companion object {
        const val MIN_FONT_SP = 2f
        const val MAX_FONT_SP = 56f
        const val WORD_FRAME_DELAY_MS = 33L
    }

    private var windowManager: WindowManager? = null
    private var orientationEventListener: OrientationEventListener? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var tv: TextView? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var textColorValue = Color.parseColor("#FFE9D2")
    private var timedLyricState: TimedLyricState? = null
    private var lastPayloadSequence = Long.MIN_VALUE
    private val renderTimedLyricRunnable = object : Runnable {
        override fun run() {
            renderTimedLyric()
        }
    }

    // 窗口信息
    private var windowWidth = 0.0
    private var windowHeight = 0.0
    private var widthPercent = 0.0
    private var leftPercent = 0.0
    private var topPercent = 0.0

    override fun onTouch(view: View, motionEvent: MotionEvent): Boolean {
        Log.d("touch", "Desktop Touch")
        return false
    }

    // 展示歌词窗口
    fun showLyricWindow(initText: String?, options: Map<String, Any>) {
        try {
            if (windowManager == null) {
                windowManager = reactContext.getSystemService(WINDOW_SERVICE) as WindowManager
                layoutParams = WindowManager.LayoutParams()

                val outMetrics = DisplayMetrics()
                windowManager?.defaultDisplay?.getMetrics(outMetrics)
                windowWidth = outMetrics.widthPixels.toDouble()
                windowHeight = outMetrics.heightPixels.toDouble()

                layoutParams?.type = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O)
                    WindowManager.LayoutParams.TYPE_SYSTEM_ALERT
                else
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY

                /*
                 * topPercent: number;
                 * leftPercent: number;
                 * align: number;
                 * color: string;
                 * backgroundColor: string;
                 * widthPercent: number;
                 * fontSize: number;
                 */
                val topPercent = options["topPercent"]
                val leftPercent = options["leftPercent"]
                val align = options["align"]
                val color = options["color"]
                val backgroundColor = options["backgroundColor"]
                val widthPercent = options["widthPercent"]
                val fontSize = options["fontSize"]

                this.widthPercent = widthPercent?.toString()?.toDouble() ?: 0.5

                layoutParams?.width = (this.widthPercent * windowWidth).toInt()
                layoutParams?.height = WindowManager.LayoutParams.WRAP_CONTENT
                layoutParams?.gravity = Gravity.TOP or Gravity.START

                this.leftPercent = leftPercent?.toString()?.toDouble() ?: 0.5
                layoutParams?.x = (this.leftPercent * (windowWidth - layoutParams!!.width)).toInt()
                layoutParams?.y = 0

                layoutParams?.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE

                layoutParams?.format = PixelFormat.TRANSPARENT

                val initialFontSp = (fontSize?.toString()?.toFloat() ?: 14f)
                    .coerceIn(MIN_FONT_SP, MAX_FONT_SP)
                textColorValue = Color.parseColor(
                    rgba2argb(color?.toString() ?: "#FFE9D2")
                )
                tv = TextView(reactContext).apply {
                    text = initText ?: ""
                    textSize = initialFontSp
                    setBackgroundColor(Color.parseColor(rgba2argb(backgroundColor?.toString() ?: "#84888153")))
                    setTextColor(textColorValue)
                    setPadding(12, 6, 12, 6)
                    gravity = align?.toString()?.toInt() ?: Gravity.CENTER
                }
                windowManager?.addView(tv, layoutParams)
                if (timedLyricState != null) {
                    renderTimedLyric()
                }

                topPercent?.toString()?.toDouble()?.let { setTopPercent(it) }

                listenOrientationChange()
            }
        } catch (e: Exception) {
            hideLyricWindow()
            throw e
        }
    }

    private fun listenOrientationChange() {
        if (windowManager == null) return

        if (orientationEventListener == null) {
            orientationEventListener = object : OrientationEventListener(reactContext, SensorManager.SENSOR_DELAY_NORMAL) {
                override fun onOrientationChanged(orientation: Int) {
                    if (windowManager != null) {
                        val outMetrics = DisplayMetrics()
                        windowManager?.defaultDisplay?.getMetrics(outMetrics)
                        windowWidth = outMetrics.widthPixels.toDouble()
                        windowHeight = outMetrics.heightPixels.toDouble()
                        layoutParams?.width = (widthPercent * windowWidth).toInt()
                        layoutParams?.x = (leftPercent * (windowWidth - layoutParams!!.width)).toInt()
                        layoutParams?.y = (topPercent * (windowHeight - tv!!.height)).toInt()
                        windowManager?.updateViewLayout(tv, layoutParams)
                    }
                }
            }
        }

        if (orientationEventListener?.canDetectOrientation() == true) {
            orientationEventListener?.enable()
        }
    }

    private fun unlistenOrientationChange() {
        orientationEventListener?.disable()
    }

    private fun rgba2argb(color: String): String {
        return if (color.length == 9) {
            color[0] + color.substring(7, 9) + color.substring(1, 7)
        } else {
            color
        }
    }

    // 隐藏歌词窗口
    fun hideLyricWindow() {
        cancelTimedLyric()
        lastPayloadSequence = Long.MIN_VALUE
        if (windowManager != null) {
            tv?.let {
                try {
                    windowManager?.removeView(it)
                } catch (e: Exception) {
                    // Handle exception
                }
                tv = null
            }
            windowManager = null
            layoutParams = null
            unlistenOrientationChange()
        }
    }

    // 设置歌词内容
    fun setText(text: String) {
        cancelTimedLyric()
        tv?.text = text
    }

    fun setTimedText(
        text: String,
        words: List<LyricWordTiming>,
        positionMs: Long,
        isPlaying: Boolean,
        playbackRate: Double,
        sequence: Long,
    ) {
        if (sequence < lastPayloadSequence) return
        lastPayloadSequence = sequence
        mainHandler.removeCallbacks(renderTimedLyricRunnable)
        if (words.isEmpty() || text.isEmpty()) {
            timedLyricState = null
            tv?.setTextColor(textColorValue)
            tv?.text = text
            return
        }

        timedLyricState = TimedLyricState(
            text = text,
            words = words,
            positionMs = positionMs.coerceAtLeast(0L),
            isPlaying = isPlaying,
            playbackRate = playbackRate.takeIf { it.isFinite() && it > 0.0 } ?: 1.0,
            receivedAtRealtimeMs = SystemClock.elapsedRealtime(),
        )
        renderTimedLyric()
    }

    private fun cancelTimedLyric() {
        mainHandler.removeCallbacks(renderTimedLyricRunnable)
        timedLyricState = null
    }

    fun dispose() {
        hideLyricWindow()
        mainHandler.removeCallbacksAndMessages(null)
        orientationEventListener = null
    }

    private fun currentTimedPosition(state: TimedLyricState): Long {
        if (!state.isPlaying) return state.positionMs
        val elapsed = (SystemClock.elapsedRealtime() - state.receivedAtRealtimeMs)
            .coerceAtLeast(0L)
        return state.positionMs + (elapsed * state.playbackRate).toLong()
    }

    private fun colorWithAlpha(color: Int, ratio: Float): Int {
        val alpha = (Color.alpha(color) * ratio).toInt().coerceIn(0, 255)
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
    }

    private fun renderTimedLyric() {
        mainHandler.removeCallbacks(renderTimedLyricRunnable)
        val state = timedLyricState ?: return
        val textView = tv ?: return
        val positionMs = currentTimedPosition(state)
        val spannable = SpannableString(state.text)
        if (state.text.isNotEmpty()) {
            spannable.setSpan(
                ForegroundColorSpan(colorWithAlpha(textColorValue, 0.46f)),
                0,
                state.text.length,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
        }

        state.words.forEach { word ->
            var start = word.startIndex.coerceIn(0, state.text.length)
            var end = word.endIndex.coerceIn(start, state.text.length)
            if (
                start > 0 &&
                start < state.text.length &&
                Character.isLowSurrogate(state.text[start]) &&
                Character.isHighSurrogate(state.text[start - 1])
            ) {
                start -= 1
            }
            if (
                end > 0 &&
                end < state.text.length &&
                Character.isLowSurrogate(state.text[end]) &&
                Character.isHighSurrogate(state.text[end - 1])
            ) {
                end += 1
            }
            if (end <= start || positionMs < word.startTimeMs) return@forEach

            val duration = word.durationMs.coerceAtLeast(1L)
            val progress = ((positionMs - word.startTimeMs).toDouble() / duration)
                .coerceIn(0.0, 1.0)
            val codePointCount = Character.codePointCount(state.text, start, end)
            val activeCodePoints = if (progress >= 1.0) {
                codePointCount
            } else {
                Math.ceil(codePointCount * progress)
                    .toInt()
                    .coerceIn(1, codePointCount)
            }
            if (activeCodePoints <= 0) return@forEach

            val activeEnd = Character.offsetByCodePoints(
                state.text,
                start,
                activeCodePoints,
            ).coerceAtMost(end)
            if (activeEnd > start) {
                spannable.setSpan(
                    ForegroundColorSpan(textColorValue),
                    start,
                    activeEnd,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                )
            }
        }
        textView.text = spannable

        val lastWordEnd = state.words.maxOfOrNull {
            val duration = it.durationMs.coerceAtLeast(1L)
            it.startTimeMs.coerceAtMost(Long.MAX_VALUE - duration) + duration
        } ?: 0L
        if (state.isPlaying && positionMs <= lastWordEnd) {
            mainHandler.postDelayed(renderTimedLyricRunnable, WORD_FRAME_DELAY_MS)
        }
    }

    fun setAlign(gravity: Int) {
        tv?.gravity = gravity
    }

    fun setTopPercent(pct: Double) {
        var percent = pct.coerceIn(0.0, 1.0)
        tv?.let {
            layoutParams?.y = (percent * (windowHeight - it.height)).toInt()
            windowManager?.updateViewLayout(it, layoutParams)
        }
        this.topPercent = percent
    }

    fun setLeftPercent(pct: Double) {
        var percent = pct.coerceIn(0.0, 1.0)
        tv?.let {
            layoutParams?.x = (percent * (windowWidth - layoutParams!!.width)).toInt()
            windowManager?.updateViewLayout(it, layoutParams)
        }
        this.leftPercent = percent
    }

    fun setColors(textColor: String?, backgroundColor: String?) {
        tv?.let {
            textColor?.let { color ->
                textColorValue = Color.parseColor(rgba2argb(color))
                it.setTextColor(textColorValue)
            }
            backgroundColor?.let { color ->
                it.background = ColorDrawable(Color.parseColor(rgba2argb(color)))
            }
        }
        if (timedLyricState != null) {
            renderTimedLyric()
        }
    }

    fun setWidth(pct: Double) {
        var percent = pct.coerceIn(0.3, 1.0)
        tv?.let {
            val width = (percent * windowWidth).toInt()
            val originalWidth = layoutParams?.width ?: 0
            layoutParams?.x = if (width <= originalWidth) {
                layoutParams!!.x + (originalWidth - width) / 2
            } else {
                layoutParams!!.x - (width - originalWidth) / 2
            }.coerceAtLeast(0).coerceAtMost((windowWidth - width).toInt())
            layoutParams?.width = width
            windowManager?.updateViewLayout(it, layoutParams)
        }
        this.widthPercent = percent
    }

    fun setFontSize(fontSize: Float) {
        tv?.textSize = fontSize.coerceIn(MIN_FONT_SP, MAX_FONT_SP)
    }
}

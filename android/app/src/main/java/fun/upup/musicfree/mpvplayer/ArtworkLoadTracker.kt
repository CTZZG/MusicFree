package `fun`.upup.musicfree.mpvplayer

/**
 * 当前曲目封面的加载轮次。
 *
 * 换曲（或封面地址变化）开始新的一轮；暂时性失败按退避间隔重试，直到成功、
 * 放弃，或被下一首取代。Nitro 时期的 Live Update 每次刷新通知都会重新尝试
 * 加载缺失的封面，mpv 服务原先只在换曲时试一次：一次超时或断网，这首歌的
 * 通知、锁屏和 Live Update 就一直只有默认图标。
 *
 * 这里只做决策，不碰线程：[shouldFetch] 可在取图线程调用，用来跳过已经过期
 * 的排队请求；其余方法都在主线程调用。
 */
internal class ArtworkLoadTracker(
    private val retryDelaysMs: List<Long> = DEFAULT_RETRY_DELAYS_MS,
) {
    data class Attempt(val url: String, val round: Int, val number: Int)

    sealed interface Outcome {
        /** 属于当前封面，应当显示。 */
        object Apply : Outcome

        /** 已被新的一轮或同一轮里更新的请求取代，丢弃。 */
        object Stale : Outcome

        /** 当前一轮失败，[delayMs] 毫秒后重试。 */
        data class Retry(val delayMs: Long) : Outcome

        /** 当前一轮失败且不再重试：错误不会自行恢复，或次数已用完。 */
        object GiveUp : Outcome
    }

    @Volatile
    private var url: String? = null

    @Volatile
    private var loaded = false

    private var round = 0
    private var attempts = 0

    /** 开始新的一轮并返回第一次请求；没有封面地址时返回 null。 */
    fun begin(artworkUrl: String?): Attempt? {
        round += 1
        attempts = 0
        loaded = false
        url = artworkUrl?.takeIf { it.isNotBlank() }
        return nextAttempt()
    }

    /** 重试计时到点时调用；本轮已经成功或没有封面时返回 null。 */
    fun nextAttempt(): Attempt? {
        val current = url ?: return null
        if (loaded) return null
        attempts += 1
        return Attempt(current, round, attempts)
    }

    /** 取图线程联网前调用：封面已经换了或已经加载成功，就不必再请求。 */
    fun shouldFetch(attempt: Attempt): Boolean = attempt.url == url && !loaded

    fun onSuccess(attempt: Attempt): Outcome {
        // 同一地址的旧一轮请求成功也照样显示：图片是同一张。
        if (attempt.url != url) return Outcome.Stale
        loaded = true
        return Outcome.Apply
    }

    fun onFailure(attempt: Attempt, retryable: Boolean): Outcome {
        if (
            attempt.url != url ||
            attempt.round != round ||
            attempt.number != attempts ||
            loaded
        ) {
            return Outcome.Stale
        }
        val delay = if (retryable) retryDelaysMs.getOrNull(attempt.number - 1) else null
        return if (delay != null) Outcome.Retry(delay) else Outcome.GiveUp
    }

    companion object {
        /** 共 5 次尝试，最后一次大约在换曲后 52 秒。 */
        val DEFAULT_RETRY_DELAYS_MS = listOf(2_000L, 5_000L, 15_000L, 30_000L)

        /** 服务端暂时性错误与限流值得重试；其余 4xx 重试也不会变。 */
        fun isRetryableHttpStatus(code: Int): Boolean =
            code == 408 || code == 429 || code in 500..599
    }
}

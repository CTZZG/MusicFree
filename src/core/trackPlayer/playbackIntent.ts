/**
 * 播放意图：用户想不想听，和系统现在让不让出声，分开记。
 *
 * - 用户主动暂停（应用里、通知栏、锁屏、耳机、拔耳机、睡眠定时；系统永久收回
 *   音频焦点也算）会一直记着，直到用户明确要播。装载完成后的自动播放、自动播放
 *   补偿、切歌取源超时后的回滚都不能把它放出来。
 * - 系统临时打断（来电、短视频等临时占用音频焦点）不改用户意图：打断期间不许
 *   自动出声，系统还回焦点后，打断前和打断期间都没有主动暂停的才接着播。
 * - 切歌时为了等新歌地址先把当前这首停下，属于内部暂停，不经过这里，也不算
 *   用户暂停。
 */
export class PlaybackIntent {
    private pausedByUser = false;
    private interrupted = false;

    /** 用户主动暂停了，还没再明确要播 */
    get isPausedByUser() {
        return this.pausedByUser;
    }

    /** 系统临时收回了音频焦点，还没还回来 */
    get isInterrupted() {
        return this.interrupted;
    }

    /** 用户主动暂停 */
    pause() {
        this.pausedByUser = true;
    }

    /**
     * 用户明确要播：点播放、点歌、上一首、下一首。用户的操作优先，系统打断
     * 也一并结束。
     */
    play() {
        this.pausedByUser = false;
        this.interrupted = false;
    }

    /** 系统临时收回音频焦点 */
    interrupt() {
        this.interrupted = true;
    }

    /**
     * 系统还回音频焦点。返回要不要接着播：确实处在打断中，而且打断前、打断
     * 期间都没有主动暂停。
     */
    endInterruption() {
        const wasInterrupted = this.interrupted;
        this.interrupted = false;
        return wasInterrupted && !this.pausedByUser;
    }

    /**
     * 不是用户当场操作的出声（装载完成自动播放、自动播放补偿、回滚后接着放、
     * 打断结束后接着放）现在能不能发生。
     */
    mayAutoPlay() {
        return !this.pausedByUser && !this.interrupted;
    }
}

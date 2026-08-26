/**
 * Last.fm scrobble 的纯判定层：什么算「听过了」、离线队列怎么裁、批量请求
 * 参数怎么拼。全是纯函数，不碰网络、不碰存储，方便直接测。
 *
 * 判定规则照搬 Last.fm 官方 scrobbling 规范：曲目时长必须超过 30 秒，且实际
 * 收听时长达到「一半时长」或「4 分钟」中先到的那个。不自己发明规则，是为了
 * 让本地记录和服务端最终统计对得上。
 */

/** 官方规定：短于这个长度的曲目不参与 scrobble。 */
export const MIN_SCROBBLE_DURATION_SECONDS = 30;

/** 官方规定的绝对上限：听满 4 分钟就算数，无论整首多长。 */
export const SCROBBLE_ABSOLUTE_THRESHOLD_SECONDS = 240;

/** 单次 track.scrobble 最多提交 50 条。 */
export const MAX_SCROBBLE_BATCH = 50;

/** 离线队列上限，超出丢最旧的，避免长期离线把存储撑爆。 */
export const MAX_PENDING_SCROBBLES = 500;

export interface ScrobbleEntry {
    artist: string;
    track: string;
    album?: string;
    /** 曲目总时长，秒 */
    duration?: number;
    /** 开始播放的时刻，Unix 秒 */
    timestamp: number;
}

export interface ScrobbleEligibilityInput {
    /** 曲目总时长，秒 */
    duration: number;
    /** 实际收听时长，秒（不含暂停，不重复计已经拖回去重听的部分） */
    listenedSeconds: number;
}

export function isScrobbleEligible(input: ScrobbleEligibilityInput): boolean {
    const { duration, listenedSeconds } = input;
    if (
        !Number.isFinite(duration) ||
        !Number.isFinite(listenedSeconds) ||
        duration <= MIN_SCROBBLE_DURATION_SECONDS ||
        listenedSeconds <= 0
    ) {
        return false;
    }
    const threshold = Math.min(
        duration / 2,
        SCROBBLE_ABSOLUTE_THRESHOLD_SECONDS,
    );
    return listenedSeconds >= threshold;
}

/**
 * 把播放项翻成 scrobble 条目。artist 或 track 为空的条目直接判废——Last.fm
 * 两个字段都必填，缺一个提交上去只会被服务端整批拒掉，不如本地就丢掉。
 */
export function toScrobbleEntry(
    musicItem: {
        title?: string | null;
        artist?: string | null;
        album?: string | null;
        duration?: number | null;
    } | null | undefined,
    timestamp: number,
): ScrobbleEntry | null {
    const track = (musicItem?.title ?? "").trim();
    const artist = (musicItem?.artist ?? "").trim();
    if (!track || !artist) {
        return null;
    }
    const album = (musicItem?.album ?? "").trim();
    const duration =
        typeof musicItem?.duration === "number" &&
        Number.isFinite(musicItem.duration) &&
        musicItem.duration > 0
            ? Math.round(musicItem.duration)
            : undefined;
    return {
        artist,
        track,
        album: album || undefined,
        duration,
        timestamp: Math.floor(timestamp),
    };
}

/** 新条目追加进离线队列并按上限裁剪（丢最旧的）。 */
export function appendPendingScrobble(
    pending: ReadonlyArray<ScrobbleEntry>,
    entry: ScrobbleEntry,
): ScrobbleEntry[] {
    const next = [...pending, entry];
    if (next.length <= MAX_PENDING_SCROBBLES) {
        return next;
    }
    return next.slice(next.length - MAX_PENDING_SCROBBLES);
}

/**
 * 拼 track.scrobble 的批量参数。Last.fm 的批量格式是给每个字段加 `[i]` 下标，
 * 下标必须从 0 开始连续。
 */
export function buildScrobbleBatchParams(
    entries: ReadonlyArray<ScrobbleEntry>,
): Record<string, string> {
    const params: Record<string, string> = {};
    entries.slice(0, MAX_SCROBBLE_BATCH).forEach((entry, index) => {
        params[`artist[${index}]`] = entry.artist;
        params[`track[${index}]`] = entry.track;
        params[`timestamp[${index}]`] = String(entry.timestamp);
        if (entry.album) {
            params[`album[${index}]`] = entry.album;
        }
        if (entry.duration) {
            params[`duration[${index}]`] = String(entry.duration);
        }
    });
    return params;
}

export function buildNowPlayingParams(
    entry: ScrobbleEntry,
): Record<string, string> {
    const params: Record<string, string> = {
        artist: entry.artist,
        track: entry.track,
    };
    if (entry.album) {
        params.album = entry.album;
    }
    if (entry.duration) {
        params.duration = String(entry.duration);
    }
    return params;
}

/**
 * 累计「真实收听时长」。直接用位置差会把用户往回拖再听一遍的部分重复计入，
 * 也会把快进跳过的部分白送，所以只按墙上时钟累加，并对单次增量设上限——
 * 上限用于把「App 被挂起很久后回来」这种超大间隔掐掉，不让它一次性凑够阈值。
 */
export function accumulateListenedSeconds(
    current: number,
    elapsedSeconds: number,
    maxStepSeconds = 5,
): number {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
        return current;
    }
    return current + Math.min(elapsedSeconds, maxStepSeconds);
}

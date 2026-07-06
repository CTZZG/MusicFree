import type { IParsedLrcItem } from "@/utils/lrcParser";

function hasTimedWordData(item: IParsedLrcItem) {
    return !!item.hasWordByWord && !!item.words?.length;
}

export function hasSeekableLyricTimeline(lyrics: IParsedLrcItem[]) {
    return lyrics.some(item => {
        if (!Number.isFinite(item.time)) {
            return false;
        }
        return item.time > 0 || hasTimedWordData(item);
    });
}

export function getLyricSeekTimeSeconds(
    item: IParsedLrcItem | undefined,
    lyrics: IParsedLrcItem[],
    offsetSeconds = 0,
) {
    if (!item || !hasSeekableLyricTimeline(lyrics)) {
        return undefined;
    }
    if (!Number.isFinite(item.time)) {
        return undefined;
    }
    const seekTime = item.time + offsetSeconds;
    if (!Number.isFinite(seekTime)) {
        return undefined;
    }
    return Math.max(0, seekTime);
}

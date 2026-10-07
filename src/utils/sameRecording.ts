import { parseArtists } from "./artistParser";

/**
 * 判断两个来源里的歌是不是同一个录音，播放失败时据此换到别的来源。
 *
 * 宁可找不到，也不能放错：歌名（连同括号里的版本说明，如 Live、伴奏、DJ 版）和歌手
 * 都要一致，两边的时长都要有、相差不超过 2 秒（各平台的时长常有 1 秒的取整差）。
 * 专辑不要求一致，只用来排序：同一个录音常同时收在原专辑和精选集里。
 */

export const MAX_DURATION_DIFF_SECONDS = 2;
// 专辑不一致的候选排在所有专辑一致的候选后面
const ALBUM_MISMATCH_PENALTY = MAX_DURATION_DIFF_SECONDS + 1;

function normalizeText(value: unknown) {
    if (typeof value !== "string") {
        return "";
    }
    return value
        // 全角转半角：（Live）→ (Live)、Ｌｉｖｅ → Live
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[[【〔〖]/g, "(")
        .replace(/[\]】〕〗]/g, ")")
        .replace(/\s*([()])\s*/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

function durationSeconds(value: unknown) {
    const seconds = typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
            ? Number(value)
            : NaN;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

interface RecordingSignature {
    title: string;
    artists: string[];
    album: string;
    duration: number;
}

function recordingSignature(item: Partial<IMusic.IMusicItem> | null | undefined): RecordingSignature | null {
    const title = normalizeText(item?.title);
    const artistText = typeof item?.artist === "string" ? item.artist.normalize("NFKC") : "";
    const artists = [...new Set(parseArtists(artistText).map(normalizeText).filter(Boolean))].sort();
    const duration = durationSeconds(item?.duration);
    if (!title || artists.length === 0 || duration === null) {
        return null;
    }
    return { title, artists, album: normalizeText(item?.album), duration };
}

/**
 * 是同一个录音时返回排序用的分数（越小越接近），不是或信息不够时返回 null。
 */
export function matchRecording(
    target: Partial<IMusic.IMusicItem> | null | undefined,
    candidate: Partial<IMusic.IMusicItem> | null | undefined,
): number | null {
    const left = recordingSignature(target);
    const right = recordingSignature(candidate);
    if (!left || !right || left.title !== right.title) {
        return null;
    }
    if (
        left.artists.length !== right.artists.length ||
        left.artists.some((artist, index) => artist !== right.artists[index])
    ) {
        return null;
    }
    const durationDiff = Math.abs(left.duration - right.duration);
    if (durationDiff > MAX_DURATION_DIFF_SECONDS) {
        return null;
    }
    const sameAlbum = left.album !== "" && left.album === right.album;
    return durationDiff + (sameAlbum ? 0 : ALBUM_MISMATCH_PENALTY);
}

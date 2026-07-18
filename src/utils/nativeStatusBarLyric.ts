export interface INativeStatusBarLyricWord {
    text: string;
    startTime: number;
    duration: number;
    startIndex: number;
    endIndex: number;
}

export interface INativeStatusBarLyricPayload {
    sequence: number;
    text: string;
    words: INativeStatusBarLyricWord[];
    positionMs: number;
    isPlaying: boolean;
    playbackRate: number;
    musicKey?: string;
    lyricIndex?: number;
}

interface INativeLyricPartInput {
    text: string;
    hasWordByWord: boolean;
    words: ILyric.IWordData[];
    isPseudoWordByWord?: boolean;
}

function finiteNonNegative(value: number, fallback = 0) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function buildNativeStatusBarLyricWords(
    displayText: string,
    part?: INativeLyricPartInput,
    partOffset?: number,
    normalizedPartText?: string,
    allowPseudoWordByWord = false,
) {
    if (
        !part ||
        !part.hasWordByWord ||
        (part.isPseudoWordByWord && !allowPseudoWordByWord) ||
        !part.text ||
        !part.words.length
    ) {
        return [];
    }

    const partText = normalizedPartText ?? part.text;
    const lineOffset = partOffset ?? displayText.indexOf(partText);
    if (lineOffset < 0) {
        return [];
    }

    let cursor = lineOffset;
    const lineEnd = lineOffset + partText.length;
    const result: INativeStatusBarLyricWord[] = [];

    part.words.forEach(word => {
        if (!word.text) {
            return;
        }
        const startIndex = displayText.indexOf(word.text, cursor);
        if (startIndex < cursor || startIndex >= lineEnd) {
            return;
        }
        const endIndex = Math.min(lineEnd, startIndex + word.text.length);
        if (endIndex <= startIndex) {
            return;
        }

        result.push({
            text: displayText.slice(startIndex, endIndex),
            startTime: finiteNonNegative(word.startTime),
            duration: Math.max(1, finiteNonNegative(word.duration, 1)),
            startIndex,
            endIndex,
        });
        cursor = endIndex;
    });

    return result;
}

export function buildNativeStatusBarLyricPayload(options: {
    text: string;
    part?: INativeLyricPartInput;
    partOffset?: number;
    normalizedPartText?: string;
    sequence?: number;
    positionMs: number;
    isPlaying: boolean;
    playbackRate?: number;
    musicKey?: string;
    lyricIndex?: number;
    enableWordByWord?: boolean;
    allowPseudoWordByWord?: boolean;
}): INativeStatusBarLyricPayload {
    const playbackRate = Number(options.playbackRate);
    return {
        sequence: finiteNonNegative(options.sequence ?? 0),
        text: options.text,
        words:
            options.enableWordByWord === false
                ? []
                : buildNativeStatusBarLyricWords(
                    options.text,
                    options.part,
                    options.partOffset,
                    options.normalizedPartText,
                    options.allowPseudoWordByWord,
                ),
        positionMs: finiteNonNegative(options.positionMs),
        isPlaying: options.isPlaying,
        playbackRate:
            Number.isFinite(playbackRate) && playbackRate > 0
                ? playbackRate
                : 1,
        musicKey: options.musicKey,
        lyricIndex: options.lyricIndex,
    };
}

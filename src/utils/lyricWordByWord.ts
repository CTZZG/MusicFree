import type { IParsedLrcItem } from "@/utils/lrcParser";

export type LyricWordLineType = "original" | "translation" | "romanization";

interface ILyricWordDataResult {
    hasWordByWord: boolean;
    words: ILyric.IWordData[];
    lineStartTimeMs: number;
    isPseudoWordByWord?: boolean;
}

const DEFAULT_LINE_DURATION_MS = 3600;
const MIN_LINE_DURATION_MS = 900;
const MAX_LINE_DURATION_MS = 8000;
const MIN_WORD_DURATION_MS = 50;

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

export function getLyricLineStartTimeMs(item: IParsedLrcItem) {
    return Math.max(0, Math.round((item.time ?? 0) * 1000));
}

function getLineText(item: IParsedLrcItem, type: LyricWordLineType) {
    if (type === "translation") {
        return item.translation ?? "";
    }
    if (type === "romanization") {
        return item.romanization ?? "";
    }
    return item.lrc ?? "";
}

function getLineDurationMs(
    item: IParsedLrcItem,
    type: LyricWordLineType,
    nextItem?: IParsedLrcItem,
) {
    const explicitDuration =
        type === "translation"
            ? item.translationDuration
            : type === "romanization"
              ? item.romanizationDuration
              : item.duration;

    if (explicitDuration && explicitDuration > 0) {
        return clamp(
            explicitDuration,
            MIN_LINE_DURATION_MS,
            MAX_LINE_DURATION_MS,
        );
    }

    if (nextItem && nextItem.time > item.time) {
        return clamp(
            Math.round((nextItem.time - item.time) * 1000),
            MIN_LINE_DURATION_MS,
            MAX_LINE_DURATION_MS,
        );
    }

    return DEFAULT_LINE_DURATION_MS;
}

function getRealWords(item: IParsedLrcItem, type: LyricWordLineType) {
    if (type === "translation") {
        return item.hasTranslationWordByWord ? item.translationWords : undefined;
    }
    if (type === "romanization") {
        return item.hasRomanizationWordByWord ? item.romanizationWords : undefined;
    }
    return item.hasWordByWord ? item.words : undefined;
}

export function normalizeLyricWords(
    words: ILyric.IWordData[],
    lineStartTimeMs: number,
) {
    if (!words.length) {
        return [];
    }

    const maxStartTime = Math.max(...words.map(word => word.startTime));
    const shouldShiftRelativeTime =
        lineStartTimeMs > 1000 && maxStartTime < lineStartTimeMs - 500;

    return words.map((word, index) => {
        const nextWord = words[index + 1];
        const hasDuplicateSpace =
            !!word.space &&
            (word.text.endsWith(" ") || !!nextWord?.text.startsWith(" "));

        return {
            ...word,
            startTime: shouldShiftRelativeTime
                ? lineStartTimeMs + word.startTime
                : word.startTime,
            duration: Math.max(word.duration || 0, MIN_WORD_DURATION_MS),
            space: hasDuplicateSpace ? false : word.space,
        };
    });
}

export function createPseudoWordData(
    text: string,
    lineStartTimeMs: number,
    lineDurationMs: number,
) {
    const characters = Array.from(text);
    if (!characters.length) {
        return [];
    }

    const wordDuration = Math.max(
        MIN_WORD_DURATION_MS,
        lineDurationMs / characters.length,
    );

    return characters.map((character, index) => ({
        text: character,
        startTime: lineStartTimeMs + wordDuration * index,
        duration: wordDuration,
        space: false,
    }));
}

export function getLyricWordData(
    item: IParsedLrcItem,
    type: LyricWordLineType,
    nextItem?: IParsedLrcItem,
    allowPseudoWordByWord = true,
): ILyricWordDataResult {
    const lineStartTimeMs = getLyricLineStartTimeMs(item);
    const realWords = getRealWords(item, type);

    if (realWords?.length) {
        return {
            hasWordByWord: true,
            words: normalizeLyricWords(realWords, lineStartTimeMs),
            lineStartTimeMs,
            isPseudoWordByWord:
                type === "translation" ||
                (type === "romanization" ? item.isRomanizationPseudo : false),
        };
    }

    const text = getLineText(item, type);
    if (!allowPseudoWordByWord || !text.trim()) {
        return {
            hasWordByWord: false,
            words: [],
            lineStartTimeMs,
        };
    }

    return {
        hasWordByWord: true,
        words: createPseudoWordData(
            text,
            lineStartTimeMs,
            getLineDurationMs(item, type, nextItem),
        ),
        lineStartTimeMs,
        isPseudoWordByWord: true,
    };
}

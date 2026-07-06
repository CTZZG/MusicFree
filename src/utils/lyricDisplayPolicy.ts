export type LyricDisplayLineType = "original" | "translation" | "romanization";

export interface ILyricDisplayLine {
    originalText?: string;
    translationText?: string;
    romanizationText?: string;
    isEmptyLine?: boolean;
}

export interface IFormatLyricSurfaceTextOptions {
    order?: LyricDisplayLineType[];
    showTranslation?: boolean;
    showRomanization?: boolean;
    emptyLineText?: string;
    joiner?: string;
    maxCodePoints?: number;
}

const defaultOrder: LyricDisplayLineType[] = [
    "original",
    "translation",
    "romanization",
];

export const LYRIC_INSTRUMENTAL_GAP_TEXT = "♪";
export const LYRIC_CHIP_MAX_CODE_POINTS = 12;
export const LYRIC_TRUNCATION_MARK = "…";

export function normalizeLyricSurfaceText(text?: string | null) {
    return `${text ?? ""}`
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function truncateLyricSurfaceText(
    text: string,
    maxCodePoints = LYRIC_CHIP_MAX_CODE_POINTS,
) {
    const normalized = normalizeLyricSurfaceText(text);
    if (!normalized || maxCodePoints <= 0) {
        return "";
    }

    const codePoints = Array.from(normalized);
    if (codePoints.length <= maxCodePoints) {
        return normalized;
    }
    if (maxCodePoints <= 1) {
        return LYRIC_TRUNCATION_MARK;
    }

    return [
        ...codePoints.slice(0, maxCodePoints - 1),
        LYRIC_TRUNCATION_MARK,
    ].join("");
}

export function formatLyricSurfaceText(
    line: ILyricDisplayLine | null | undefined,
    options: IFormatLyricSurfaceTextOptions = {},
) {
    if (!line) {
        return "";
    }

    const order = options.order?.length ? options.order : defaultOrder;
    const lines: string[] = [];

    order.forEach(type => {
        if (type === "original") {
            const text = normalizeLyricSurfaceText(line.originalText);
            if (text) {
                lines.push(text);
            }
        } else if (type === "translation" && options.showTranslation) {
            const text = normalizeLyricSurfaceText(line.translationText);
            if (text) {
                lines.push(text);
            }
        } else if (type === "romanization" && options.showRomanization) {
            const text = normalizeLyricSurfaceText(line.romanizationText);
            if (text) {
                lines.push(text);
            }
        }
    });

    const displayText = lines.length
        ? lines.join(options.joiner ?? "\n").trim()
        : line.isEmptyLine
            ? options.emptyLineText ?? LYRIC_INSTRUMENTAL_GAP_TEXT
            : "";

    if (options.maxCodePoints === undefined) {
        return displayText;
    }

    return truncateLyricSurfaceText(displayText, options.maxCodePoints);
}

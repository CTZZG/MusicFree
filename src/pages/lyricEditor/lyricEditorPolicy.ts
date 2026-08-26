export interface IEditableLyricLine {
    id: string;
    timeMs: number;
    text: string;
}

export interface IParsedLyricForEditing {
    meta: Record<string, string>;
    lines: IEditableLyricLine[];
}

const META_LINE_PATTERN = /^\[([a-zA-Z]+):(.*)\]$/;
// 一行开头可能带多个时间戳，如 [00:01.00][00:05.00]同一句歌词
const LEADING_TIMESTAMPS_PATTERN = /^(\[\d{1,3}:\d{1,2}(?:\.\d{1,3})?\])+/;
const SINGLE_TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;

function timeToMs(minutes: string, seconds: string, fraction?: string) {
    const fractionMs = fraction
        ? Math.round(Number(`0.${fraction}`) * 1000)
        : 0;
    return (Number(minutes) * 60 + Number(seconds)) * 1000 + fractionMs;
}

/**
 * 把已有 LRC 文本解析成可编辑的行数组，供逐行打轴编辑器使用。
 * 只处理原文时间戳，不解析逐字/翻译/罗马音——那些由既有面板单独管理。
 */
export function parseLyricForEditing(
    rawLrc: string,
    makeId: () => string,
): IParsedLyricForEditing {
    const meta: Record<string, string> = {};
    const lines: IEditableLyricLine[] = [];

    (rawLrc ?? "").split(/\r\n|\r|\n/).forEach(rawLine => {
        const line = rawLine.trim();
        if (!line) {
            return;
        }

        const metaMatch = line.match(META_LINE_PATTERN);
        if (metaMatch && !LEADING_TIMESTAMPS_PATTERN.test(line)) {
            meta[metaMatch[1]] = metaMatch[2];
            return;
        }

        const leadingMatch = line.match(LEADING_TIMESTAMPS_PATTERN);
        if (!leadingMatch) {
            return;
        }
        const text = line.slice(leadingMatch[0].length);
        const timestamps = leadingMatch[0].matchAll(SINGLE_TIMESTAMP_PATTERN);
        for (const match of timestamps) {
            lines.push({
                id: makeId(),
                timeMs: timeToMs(match[1], match[2], match[3]),
                text,
            });
        }
    });

    lines.sort((a, b) => a.timeMs - b.timeMs);

    return { meta, lines };
}

export function formatEditableLyricTime(timeMs: number) {
    const clamped = Math.max(0, Math.round(timeMs));
    const minutes = Math.floor(clamped / 60000);
    const seconds = Math.floor((clamped % 60000) / 1000);
    const millis = clamped % 1000;
    return `${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

/** 解析 "mm:ss.xxx" / "mm:ss" 形式的手动输入时间，非法输入返回 null。 */
export function parseEditableLyricTime(text: string): number | null {
    const match = text.trim().match(/^(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) {
        return null;
    }
    return timeToMs(match[1], match[2], match[3]);
}

export function serializeLyricForEditing(parsed: IParsedLyricForEditing) {
    const metaLines = Object.entries(parsed.meta)
        .filter(([, value]) => !!value)
        .map(([key, value]) => `[${key}:${value}]`);

    const sortedLines = sortLyricLinesByTime(parsed.lines);
    const lyricLines = sortedLines.map(
        line => `[${formatEditableLyricTime(line.timeMs)}]${line.text}`,
    );

    return [...metaLines, ...(metaLines.length ? [""] : []), ...lyricLines]
        .join("\n");
}

export function insertLyricLine(
    lines: readonly IEditableLyricLine[],
    index: number,
    line: IEditableLyricLine,
): IEditableLyricLine[] {
    const clampedIndex = Math.min(Math.max(index, 0), lines.length);
    const next = lines.slice();
    next.splice(clampedIndex, 0, line);
    return next;
}

export function removeLyricLine(
    lines: readonly IEditableLyricLine[],
    id: string,
): IEditableLyricLine[] {
    return lines.filter(line => line.id !== id);
}

export function updateLyricLineText(
    lines: readonly IEditableLyricLine[],
    id: string,
    text: string,
): IEditableLyricLine[] {
    return lines.map(line => (line.id === id ? { ...line, text } : line));
}

export function updateLyricLineTime(
    lines: readonly IEditableLyricLine[],
    id: string,
    timeMs: number,
): IEditableLyricLine[] {
    const clamped = Math.max(0, Math.round(timeMs));
    return lines.map(line =>
        line.id === id ? { ...line, timeMs: clamped } : line,
    );
}

export function nudgeLyricLineTime(
    lines: readonly IEditableLyricLine[],
    id: string,
    deltaMs: number,
): IEditableLyricLine[] {
    return lines.map(line =>
        line.id === id
            ? { ...line, timeMs: Math.max(0, line.timeMs + deltaMs) }
            : line,
    );
}

export function moveLyricLine(
    lines: readonly IEditableLyricLine[],
    fromIndex: number,
    toIndex: number,
): IEditableLyricLine[] {
    if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        fromIndex >= lines.length ||
        toIndex < 0 ||
        toIndex >= lines.length
    ) {
        return lines.slice();
    }
    const next = lines.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
}

export function sortLyricLinesByTime(
    lines: readonly IEditableLyricLine[],
): IEditableLyricLine[] {
    return lines.slice().sort((a, b) => a.timeMs - b.timeMs);
}

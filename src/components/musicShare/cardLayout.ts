import { splitShareGraphemes } from "./graphemes";

/** Static image layout; does not use the playback clock or introduce another lyric renderer. */
export interface ShareLyricLine {
    index: number;
    text: string;
    translation?: string;
}
export const MAX_SHARE_LINES = 4;
export const CARD_WIDTH = 1000;

/** Conservative width budget for system-font CJK/Latin/emoji; native SVG handles shaping. */
export function wrapCardText(text: string, columns: number, maxLines: number) {
    const lines: string[] = [];
    let line = "";
    let width = 0;
    const units = (value: string) => Array.from(value).reduce((sum, point) => sum + (/[\x20-\x7e]/.test(point) ? 1 : 1.1), 0);
    for (const cluster of splitShareGraphemes(
        String(text)
            .replace(/[\r\n\t]+/g, " ")
            .trim(),
    )) {
        // Wide Latin glyphs such as W can be nearly one em in Android's
        // system font. Budget the full em instead of an average glyph width.
        const char = units(cluster) > columns ? "…" : cluster;
        const unit = units(char);
        if (width + unit > columns && line) {
            lines.push(line.trim());
            line = "";
            width = 0;
        }
        if (lines.length === maxLines) {
            const last = splitShareGraphemes(lines[maxLines - 1]);
            do {
                last.pop();
            } while (last.length && units(last.join("")) + 1 > columns);
            lines[maxLines - 1] = last.join("") + "…";
            return lines;
        }
        line += char;
        width += unit;
    }
    if (line) lines.push(line.trim());
    return lines;
}

export function getShareCardLayout(
    title: string,
    artist: string,
    lines: ShareLyricLine[],
    translation: boolean,
) {
    let y = 294;
    const text: Array<{ text: string; y: number; secondary: boolean }> = [];
    for (const line of lines.slice(0, MAX_SHARE_LINES)) {
        for (const row of wrapCardText(line.text, 17, 3)) {
            text.push({ text: row, y, secondary: false });
            y += 65;
        }
        if (translation && line.translation) {
            for (const row of wrapCardText(line.translation, 26, 2)) {
                text.push({ text: row, y, secondary: true });
                y += 43;
            }
        }
        y += 28;
    }
    return {
        title: wrapCardText(title || "MusicFree", 18, 2),
        artist: wrapCardText(artist, 28, 1),
        text,
        height: Math.max(600, y + 100),
    };
}

export function toggleShareLine(selected: number[], index: number) {
    if (selected.includes(index)) return selected.filter(item => item !== index);
    return selected.length < MAX_SHARE_LINES
        ? [...selected, index].sort((a, b) => a - b)
        : selected;
}

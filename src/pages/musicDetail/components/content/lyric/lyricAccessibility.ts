export interface IAccessibleLyricLine {
    text: string;
}

export function getLyricAccessibilityText(
    lines: readonly IAccessibleLyricLine[],
) {
    const seen = new Set<string>();
    const textParts: string[] = [];

    lines.forEach(line => {
        const text = line.text.trim();
        if (text && !seen.has(text)) {
            seen.add(text);
            textParts.push(text);
        }
    });

    return textParts.join(", ");
}

export const MUSIC_ALPHABET_SECTIONS = [
    "0",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
    "U",
    "V",
    "W",
    "X",
    "Y",
    "Z",
    "#",
] as const;

export type MusicAlphabetSection = typeof MUSIC_ALPHABET_SECTIONS[number];

export interface IMusicAlphabetIndexEntry {
    available: boolean;
    index: number | null;
    section: MusicAlphabetSection;
}

const zhCollator = new Intl.Collator("zh-Hans-CN", {
    sensitivity: "base",
});

const chineseInitialBoundaries: Array<{
    boundary: string;
    section: Exclude<MusicAlphabetSection, "0" | "#">;
}> = [
    { boundary: "阿", section: "A" },
    { boundary: "八", section: "B" },
    { boundary: "嚓", section: "C" },
    { boundary: "咑", section: "D" },
    { boundary: "妸", section: "E" },
    { boundary: "发", section: "F" },
    { boundary: "旮", section: "G" },
    { boundary: "哈", section: "H" },
    { boundary: "击", section: "J" },
    { boundary: "咔", section: "K" },
    { boundary: "垃", section: "L" },
    { boundary: "妈", section: "M" },
    { boundary: "拿", section: "N" },
    { boundary: "哦", section: "O" },
    { boundary: "啪", section: "P" },
    { boundary: "期", section: "Q" },
    { boundary: "然", section: "R" },
    { boundary: "撒", section: "S" },
    { boundary: "他", section: "T" },
    { boundary: "挖", section: "W" },
    { boundary: "西", section: "X" },
    { boundary: "压", section: "Y" },
    { boundary: "匝", section: "Z" },
];

const cjkRegex = /[\u3400-\u9fff]/u;

function normalizeFirstChar(value: unknown) {
    const rawText = `${value ?? ""}`.trim();
    if (!rawText) {
        return "";
    }

    const normalizedText = (() => {
        try {
            return rawText.normalize("NFKD");
        } catch {
            return rawText;
        }
    })();

    return Array.from(normalizedText.trim())[0] ?? "";
}

function getChineseAlphabetSection(
    char: string,
): MusicAlphabetSection | null {
    if (!cjkRegex.test(char)) {
        return null;
    }

    for (let index = chineseInitialBoundaries.length - 1; index >= 0; index -= 1) {
        const item = chineseInitialBoundaries[index];
        if (zhCollator.compare(char, item.boundary) >= 0) {
            return item.section;
        }
    }

    return "#";
}

export function getMusicAlphabetSection(value: unknown): MusicAlphabetSection {
    const firstChar = normalizeFirstChar(value);
    if (!firstChar) {
        return "#";
    }

    const chineseSection = getChineseAlphabetSection(firstChar);
    if (chineseSection) {
        return chineseSection;
    }

    const upperChar = firstChar.toUpperCase();
    if (/^[0-9]$/.test(upperChar)) {
        return "0";
    }
    if (/^[A-Z]$/.test(upperChar)) {
        return upperChar as MusicAlphabetSection;
    }

    return "#";
}

export function buildMusicAlphabetIndex<T>(
    items: readonly T[],
    getText: (item: T) => unknown,
): IMusicAlphabetIndexEntry[] {
    const firstIndexBySection = new Map<MusicAlphabetSection, number>();

    items.forEach((item, index) => {
        const section = getMusicAlphabetSection(getText(item));
        if (!firstIndexBySection.has(section)) {
            firstIndexBySection.set(section, index);
        }
    });

    return MUSIC_ALPHABET_SECTIONS.map(section => {
        const index = firstIndexBySection.get(section) ?? null;
        return {
            available: index !== null,
            index,
            section,
        };
    });
}

export function getMusicAlphabetEntryAtOffset(
    entries: readonly IMusicAlphabetIndexEntry[],
    offsetY: number,
    containerHeight: number,
) {
    if (!entries.length || containerHeight <= 0 || !Number.isFinite(offsetY)) {
        return null;
    }

    const clampedOffset = Math.max(0, Math.min(containerHeight - 1, offsetY));
    const index = Math.max(
        0,
        Math.min(
            entries.length - 1,
            Math.floor((clampedOffset / containerHeight) * entries.length),
        ),
    );

    return entries[index] ?? null;
}

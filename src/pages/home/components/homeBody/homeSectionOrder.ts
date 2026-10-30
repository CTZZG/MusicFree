export const HOME_SECTIONS = ["continue", "discovery", "recent", "shortcuts"] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

export function defaultHomeOrder(enhanced = true): HomeSection[] {
    return enhanced
        ? [...HOME_SECTIONS]
        : ["continue", "shortcuts", "recent", "discovery"];
}

/** Backup/older settings can contain unknown or duplicate sections. Never lose a new section. */
export function normalizeHomeOrder(value: unknown, enhanced = true): HomeSection[] {
    const valid = Array.isArray(value)
        ? value.filter((item): item is HomeSection => HOME_SECTIONS.includes(item))
        : [];
    return [...new Set([...valid, ...defaultHomeOrder(enhanced)])];
}

export function moveHomeSection(
    value: HomeSection[],
    section: HomeSection,
    delta: -1 | 1,
) {
    const next = [...value];
    const index = next.indexOf(section);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return value;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

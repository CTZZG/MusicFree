const artistSeparatorRegex =
    /\s*(?:\/|,|，|、|&|\bfeaturing\b|\bfeat\.?|\bft\.?)\s*/i;

export function parseArtists(artistText?: string | null): string[] {
    if (!artistText) {
        return [];
    }

    const seen = new Set<string>();
    return String(artistText)
        .split(artistSeparatorRegex)
        .map(name => name.trim())
        .filter(name => {
            if (!name || seen.has(name)) {
                return false;
            }
            seen.add(name);
            return true;
        });
}

export function hasMultipleArtists(artistText?: string | null): boolean {
    return parseArtists(artistText).length > 1;
}

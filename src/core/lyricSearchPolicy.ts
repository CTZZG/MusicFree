import minDistance from "@/utils/minDistance";

export function normalizeLyricMatchText(value?: string) {
    return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function getLyricCandidateDistance(
    keyword: string,
    musicItem: Pick<IMusic.IMusicItem, "title" | "artist">,
    candidate: Pick<ILyric.ILyricItem, "title" | "artist">,
) {
    return (
        minDistance(
            normalizeLyricMatchText(candidate.title),
            normalizeLyricMatchText(keyword),
        ) +
        minDistance(
            normalizeLyricMatchText(candidate.artist),
            normalizeLyricMatchText(musicItem.artist),
        )
    );
}

export function isLyricCandidateMatchAcceptable(
    keyword: string,
    musicItem: Pick<IMusic.IMusicItem, "title" | "artist">,
    candidate: Pick<ILyric.ILyricItem, "title" | "artist">,
) {
    const normalizedKeyword = normalizeLyricMatchText(keyword);
    const normalizedArtist = normalizeLyricMatchText(musicItem.artist);
    const candidateTitle = normalizeLyricMatchText(candidate.title);
    const candidateArtist = normalizeLyricMatchText(candidate.artist);
    if (!normalizedKeyword || !candidateTitle) {
        return false;
    }

    const titleDistance = minDistance(candidateTitle, normalizedKeyword);
    const titleThreshold = Math.max(
        1,
        Math.ceil(normalizedKeyword.length * 0.25),
    );
    if (titleDistance > titleThreshold) {
        return false;
    }

    if (!normalizedArtist) {
        return true;
    }
    const artistDistance = minDistance(candidateArtist, normalizedArtist);
    const artistThreshold = Math.max(
        1,
        Math.ceil(normalizedArtist.length * 0.35),
    );
    return artistDistance <= artistThreshold;
}

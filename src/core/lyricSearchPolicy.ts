import minDistance from "@/utils/minDistance";

export function getLyricCandidateDistance(
    keyword: string,
    musicItem: Pick<IMusic.IMusicItem, "title" | "artist">,
    candidate: Pick<ILyric.ILyricItem, "title" | "artist">,
) {
    return (
        minDistance(candidate.title, keyword) +
        minDistance(candidate.artist, musicItem.artist)
    );
}

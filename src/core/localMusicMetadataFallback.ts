export interface ILocalMusicMetadataFields {
    title: string;
    artist: string;
    duration: number;
    album: string;
}

/**
 * Enriches only fields that still equal the scanner-owned fallback snapshot.
 * A user edit made after the fallback import therefore always wins.
 */
export function resolveEnrichedLocalMusicMetadata(
    current: ILocalMusicMetadataFields,
    fallback: ILocalMusicMetadataFields,
    resolved: ILocalMusicMetadataFields,
) {
    return {
        title: current.title === fallback.title
            ? resolved.title
            : current.title,
        artist: current.artist === fallback.artist
            ? resolved.artist
            : current.artist,
        duration: current.duration === fallback.duration
            ? resolved.duration
            : current.duration,
        album: current.album === fallback.album
            ? resolved.album
            : current.album,
    };
}

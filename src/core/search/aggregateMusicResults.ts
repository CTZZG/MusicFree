import type { ISearchSourceResult } from "./searchSession";

export const ALL_MUSIC_SOURCE_KEY = "all-music-sources";
export interface MusicResultSource { hash: string; name: string }
export interface MusicResultChoice { source: MusicResultSource; musicItem: IMusic.IMusicItem }
export interface MusicResultGroup { key: string; choices: MusicResultChoice[] }

function normalized(value: unknown) {
    return typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase() : "";
}

/** Missing version metadata is not evidence that two recordings are the same. */
function recordingKey(item: IMusic.IMusicItem) {
    const title = normalized(item.title);
    const artist = normalized(item.artist);
    const album = normalized(item.album);
    if (!title || !artist || !album || !Number.isFinite(item.duration) || item.duration <= 0) {
        return null;
    }
    // Preserve all title qualifiers (live, remix, cover, language, etc.).
    return JSON.stringify([title, artist, album, Math.round(item.duration)]);
}

/** Interleave source rankings; do not invent a shared relevance score. */
export function aggregateMusicResults(
    sources: readonly MusicResultSource[],
    results: Readonly<Record<string, ISearchSourceResult<"music"> | undefined>>,
): MusicResultGroup[] {
    const groups: MusicResultGroup[] = [];
    const byRecording = new Map<string, MusicResultGroup>();
    const seen = new Set<string>();
    const ambiguous = new Set<string>();
    for (const source of sources) {
        const identities = new Map<string, string>();
        for (const item of results[source.hash]?.data ?? []) {
            if (!item || item.id == null || !item.platform) {
                continue;
            }
            const key = recordingKey(item as IMusic.IMusicItem);
            if (!key) {
                continue;
            }
            const identity = JSON.stringify([item.platform, String(item.id)]);
            if (identities.has(key) && identities.get(key) !== identity) {
                ambiguous.add(key);
            }
            identities.set(key, identity);
        }
    }
    const length = Math.max(0, ...sources.map(source => results[source.hash]?.data.length ?? 0));
    for (let rank = 0; rank < length; rank++) {
        for (const source of sources) {
            const musicItem = results[source.hash]?.data[rank] as IMusic.IMusicItem | undefined;
            if (!musicItem || musicItem.id == null || !musicItem.platform) {
                continue;
            }
            const identity = JSON.stringify([source.hash, musicItem.platform, String(musicItem.id)]);
            if (seen.has(identity)) {
                continue;
            }
            seen.add(identity);
            const recording = recordingKey(musicItem);
            const key = recording && !ambiguous.has(recording) ? recording : null;
            const group = key ? byRecording.get(key) : undefined;
            // Keep distinct entries from the same provider (metadata can be identical).
            if (group && !group.choices.some(choice => choice.source.hash === source.hash)) {
                group.choices.push({ source, musicItem });
            } else {
                const next = { key: identity, choices: [{ source, musicItem }] };
                groups.push(next);
                if (key && !group) {
                    byRecording.set(key, next);
                }
            }
        }
    }
    return groups;
}

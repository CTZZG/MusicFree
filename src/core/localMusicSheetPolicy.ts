export function mergeEditedListWithConcurrentChanges<T>(params: {
    current: readonly T[];
    edited: readonly T[];
    baseline: readonly T[];
    getKey(item: T): string;
}) {
    const { current, edited, baseline, getKey } = params;
    const baselineKeys = new Set(baseline.map(getKey));
    const currentByKey = new Map(current.map(item => [getKey(item), item]));
    const seenKeys = new Set<string>();
    const merged: T[] = [];

    edited.forEach(editedItem => {
        const key = getKey(editedItem);
        if (seenKeys.has(key)) {
            return;
        }
        if (currentByKey.has(key)) {
            merged.push(currentByKey.get(key)!);
            seenKeys.add(key);
            return;
        }
        // Items introduced by the editor itself are kept. A baseline item that
        // disappeared from current was removed concurrently and must not be
        // resurrected from the stale editor snapshot.
        if (!baselineKeys.has(key)) {
            merged.push(editedItem);
            seenKeys.add(key);
        }
    });

    current.forEach(currentItem => {
        const key = getKey(currentItem);
        if (!seenKeys.has(key) && !baselineKeys.has(key)) {
            merged.push(currentItem);
            seenKeys.add(key);
        }
    });

    return merged;
}

export interface IParsedLocalMusicFilename {
    platform?: string;
    id?: string;
    title?: string;
    artist?: string;
}

interface IEmbeddedLocalMusicMetadata {
    title?: string | null;
    artist?: string | null;
}

function firstNonBlank(
    ...values: Array<string | null | undefined>
): string | undefined {
    return values.find(value => typeof value === "string" && value.trim())?.trim();
}

export function parseLocalMusicFilename(
    filename: string,
): IParsedLocalMusicFilename | null {
    const dotIndex = filename.lastIndexOf(".");
    const basename = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
    const [platform, id, title, artist] = basename.split("@");
    if (!platform || !id) {
        const displayNameMatch = basename.trim().match(/^(.+?)\s+-\s+(.+)$/);
        if (!displayNameMatch) {
            return null;
        }
        return {
            title: displayNameMatch[1].trim(),
            artist: displayNameMatch[2].trim(),
        };
    }
    return {
        platform,
        id,
        title: title?.trim(),
        artist: artist?.trim(),
    };
}

export function resolveLocalMusicImportFields(params: {
    filename: string;
    embeddedMetadata?: IEmbeddedLocalMusicMetadata | null;
    fallbackTitle: string;
    fallbackArtist: string;
}) {
    const { filename, embeddedMetadata, fallbackTitle, fallbackArtist } = params;
    const parsedFilename = parseLocalMusicFilename(filename);
    const hasStructuredIdentity = !!(
        firstNonBlank(parsedFilename?.platform) &&
        firstNonBlank(parsedFilename?.id)
    );

    return {
        platform: firstNonBlank(parsedFilename?.platform),
        id: firstNonBlank(parsedFilename?.id),
        title: hasStructuredIdentity
            ? firstNonBlank(
                parsedFilename?.title,
                embeddedMetadata?.title,
                fallbackTitle,
            )!
            : firstNonBlank(
                embeddedMetadata?.title,
                parsedFilename?.title,
                fallbackTitle,
            )!,
        artist: hasStructuredIdentity
            ? firstNonBlank(
                parsedFilename?.artist,
                embeddedMetadata?.artist,
                fallbackArtist,
            )!
            : firstNonBlank(
                embeddedMetadata?.artist,
                parsedFilename?.artist,
                fallbackArtist,
            )!,
    };
}

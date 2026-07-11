type LocalMusicArtworkLoader = (
    localPath: string,
) => Promise<string | null | undefined>;

export interface ILocalMusicArtworkResolver {
    resolve(localPath: string): Promise<string>;
    clear(): void;
}

export function createLocalMusicArtworkResolver(
    loader: LocalMusicArtworkLoader,
    maxConcurrent = 3,
): ILocalMusicArtworkResolver {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
        throw new Error("maxConcurrent must be a positive integer");
    }

    const cache = new Map<string, string>();
    const inFlight = new Map<string, Promise<string>>();
    const pending: Array<{
        localPath: string;
        resolve(value: string): void;
    }> = [];
    let activeCount = 0;

    function drain() {
        while (activeCount < maxConcurrent && pending.length) {
            const task = pending.shift()!;
            activeCount += 1;
            Promise.resolve()
                .then(() => loader(task.localPath))
                .then(
                    artwork =>
                        typeof artwork === "string" ? artwork.trim() : "",
                    () => "",
                )
                .then(artwork => {
                    cache.set(task.localPath, artwork);
                    task.resolve(artwork);
                })
                .finally(() => {
                    activeCount -= 1;
                    inFlight.delete(task.localPath);
                    drain();
                });
        }
    }

    return {
        resolve(localPath) {
            const normalizedPath = localPath.trim();
            if (!normalizedPath) {
                return Promise.resolve("");
            }
            if (cache.has(normalizedPath)) {
                return Promise.resolve(cache.get(normalizedPath)!);
            }
            const existingRequest = inFlight.get(normalizedPath);
            if (existingRequest) {
                return existingRequest;
            }

            const request = new Promise<string>(resolve => {
                pending.push({ localPath: normalizedPath, resolve });
                drain();
            });
            inFlight.set(normalizedPath, request);
            return request;
        },
        clear() {
            cache.clear();
        },
    };
}
export function getDirectArtworkUri(artwork: unknown) {
    if (typeof artwork === "string") {
        return artwork.trim();
    }
    if (
        artwork &&
        typeof artwork === "object" &&
        "uri" in artwork &&
        typeof artwork.uri === "string"
    ) {
        return artwork.uri.trim();
    }
    return "";
}

export function mergeResolvedArtwork<T extends {artwork?: unknown}>(
    musicItem: T,
    artwork: unknown,
): T {
    const resolvedArtwork = getDirectArtworkUri(artwork);
    if (!resolvedArtwork || getDirectArtworkUri(musicItem.artwork)) {
        return musicItem;
    }
    return {
        ...musicItem,
        artwork: resolvedArtwork,
    };
}

export function stripEphemeralLocalArtwork<T extends {artwork?: unknown}>(
    musicItem: T,
): T {
    const artwork = getDirectArtworkUri(musicItem.artwork);
    if (
        !/^file:/i.test(artwork) &&
        !/[/\\]cache[/\\]image_manager_disk_cache[/\\]/i.test(artwork)
    ) {
        return musicItem;
    }
    return {
        ...musicItem,
        artwork: "",
    };
}

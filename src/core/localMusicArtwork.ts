type LocalMusicArtworkLoader = (
    localPath: string,
) => Promise<string | null | undefined>;

export interface ILocalMusicArtworkResolver {
    resolve(localPath: string): Promise<string>;
    clear(): void;
    invalidate(localPath: string): void;
}

interface ILocalMusicArtworkResolverOptions {
    failureTtlMs?: number;
    maxEntries?: number;
    now?: () => number;
    successTtlMs?: number;
}

export function createLocalMusicArtworkResolver(
    loader: LocalMusicArtworkLoader,
    maxConcurrent = 3,
    options: ILocalMusicArtworkResolverOptions = {},
): ILocalMusicArtworkResolver {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
        throw new Error("maxConcurrent must be a positive integer");
    }

    const maxEntries = options.maxEntries ?? 300;
    const failureTtlMs = options.failureTtlMs ?? 30_000;
    const successTtlMs = options.successTtlMs ?? Number.POSITIVE_INFINITY;
    const now = options.now ?? Date.now;
    const cache = new Map<string, { artwork: string; expiresAt: number }>();
    const inFlight = new Map<string, Promise<string>>();
    const generations = new Map<string, number>();
    interface IArtworkTask {
        localPath: string;
        generation: number;
        cancelled: boolean;
        settle(value: string): void;
    }
    const pending: IArtworkTask[] = [];
    const activeTasks = new Set<IArtworkTask>();
    let activeCount = 0;
    let epoch = 0;

    function trimCache() {
        while (cache.size > maxEntries) {
            const oldestKey = cache.keys().next().value;
            if (typeof oldestKey !== "string") {
                break;
            }
            cache.delete(oldestKey);
        }
    }

    function drain() {
        while (activeCount < maxConcurrent && pending.length) {
            const task = pending.shift()!;
            const taskEpoch = epoch;
            activeCount += 1;
            activeTasks.add(task);
            Promise.resolve()
                .then(() => loader(task.localPath))
                .then(
                    artwork =>
                        typeof artwork === "string" ? artwork.trim() : "",
                    () => "",
                )
                .then(artwork => {
                    if (
                        !task.cancelled &&
                        taskEpoch === epoch &&
                        (generations.get(task.localPath) ?? 0) ===
                            task.generation
                    ) {
                        cache.delete(task.localPath);
                        cache.set(task.localPath, {
                            artwork,
                            expiresAt:
                                now() +
                                (artwork ? successTtlMs : failureTtlMs),
                        });
                        trimCache();
                    }
                    task.settle(task.cancelled ? "" : artwork);
                })
                .finally(() => {
                    activeTasks.delete(task);
                    activeCount -= 1;
                    if (
                        taskEpoch === epoch &&
                        (generations.get(task.localPath) ?? 0) ===
                            task.generation
                    ) {
                        inFlight.delete(task.localPath);
                    }
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
            const cached = cache.get(normalizedPath);
            if (cached) {
                if (cached.expiresAt > now()) {
                    cache.delete(normalizedPath);
                    cache.set(normalizedPath, cached);
                    return Promise.resolve(cached.artwork);
                }
                cache.delete(normalizedPath);
            }
            const existingRequest = inFlight.get(normalizedPath);
            if (existingRequest) {
                return existingRequest;
            }

            const request = new Promise<string>(resolve => {
                const task: IArtworkTask = {
                    localPath: normalizedPath,
                    generation: generations.get(normalizedPath) ?? 0,
                    cancelled: false,
                    settle(value) {
                        if (task.cancelled && value !== "") {
                            return;
                        }
                        resolve(value);
                    },
                };
                pending.push(task);
                drain();
            });
            inFlight.set(normalizedPath, request);
            return request;
        },
        clear() {
            epoch += 1;
            cache.clear();
            inFlight.clear();
            generations.clear();
            for (const task of pending.splice(0)) {
                task.cancelled = true;
                task.settle("");
            }
            for (const task of activeTasks) {
                task.cancelled = true;
                task.settle("");
            }
        },
        invalidate(localPath) {
            const normalizedPath = localPath.trim();
            if (!normalizedPath) {
                return;
            }
            cache.delete(normalizedPath);
            inFlight.delete(normalizedPath);
            generations.set(
                normalizedPath,
                (generations.get(normalizedPath) ?? 0) + 1,
            );
            for (let index = pending.length - 1; index >= 0; index--) {
                const task = pending[index];
                if (task.localPath === normalizedPath) {
                    pending.splice(index, 1);
                    task.cancelled = true;
                    task.settle("");
                }
            }
            for (const task of activeTasks) {
                if (task.localPath === normalizedPath) {
                    task.cancelled = true;
                    task.settle("");
                }
            }
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

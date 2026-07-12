import { exists } from "react-native-fs";

interface IPathValueCacheOptions<T> {
    maxConcurrent?: number;
    maxEntries?: number;
    getTtlMs?: (value: T) => number;
    now?: () => number;
}

interface ICachedValue<T> {
    expiresAt: number;
    value: T;
}

export interface IPathValueResolver<T> {
    clear(): void;
    invalidate(path: string): void;
    peek(path: string): T | undefined;
    resolve(path: string): Promise<T>;
}

const defaultMaxConcurrent = 6;
const defaultMaxEntries = 2500;

export function createPathValueResolver<T>(
    loader: (path: string) => Promise<T>,
    options: IPathValueCacheOptions<T> = {},
): IPathValueResolver<T> {
    const maxConcurrent = options.maxConcurrent ?? defaultMaxConcurrent;
    const maxEntries = options.maxEntries ?? defaultMaxEntries;
    const getTtlMs = options.getTtlMs ?? (() => 30_000);
    const now = options.now ?? Date.now;

    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
        throw new Error("maxConcurrent must be a positive integer");
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
        throw new Error("maxEntries must be a positive integer");
    }

    const cache = new Map<string, ICachedValue<T>>();
    const generations = new Map<string, number>();
    const inFlight = new Map<string, Promise<T>>();
    const pending: Array<{
        generation: number;
        path: string;
        resolve(value: T): void;
        reject(reason?: unknown): void;
    }> = [];
    let activeCount = 0;
    let epoch = 0;

    function normalizePath(path: string) {
        return path.trim();
    }

    function touch(path: string, entry: ICachedValue<T>) {
        cache.delete(path);
        cache.set(path, entry);
    }

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
            Promise.resolve()
                .then(() => loader(task.path))
                .then(value => {
                    if (
                        taskEpoch === epoch &&
                        (generations.get(task.path) ?? 0) === task.generation
                    ) {
                        const ttlMs = Math.max(0, getTtlMs(value));
                        touch(task.path, {
                            value,
                            expiresAt: now() + ttlMs,
                        });
                        trimCache();
                    }
                    task.resolve(value);
                }, task.reject)
                .finally(() => {
                    activeCount -= 1;
                    if (
                        taskEpoch === epoch &&
                        (generations.get(task.path) ?? 0) === task.generation
                    ) {
                        inFlight.delete(task.path);
                    }
                    drain();
                });
        }
    }

    return {
        resolve(path) {
            const normalizedPath = normalizePath(path);
            if (!normalizedPath) {
                return Promise.reject(new Error("path must not be empty"));
            }

            const cached = cache.get(normalizedPath);
            if (cached) {
                if (cached.expiresAt > now()) {
                    touch(normalizedPath, cached);
                    return Promise.resolve(cached.value);
                }
                cache.delete(normalizedPath);
            }

            const existingRequest = inFlight.get(normalizedPath);
            if (existingRequest) {
                return existingRequest;
            }

            const generation = generations.get(normalizedPath) ?? 0;
            const request = new Promise<T>((resolve, reject) => {
                pending.push({
                    generation,
                    path: normalizedPath,
                    resolve,
                    reject,
                });
                drain();
            });
            inFlight.set(normalizedPath, request);
            return request;
        },
        peek(path) {
            const normalizedPath = normalizePath(path);
            const cached = cache.get(normalizedPath);
            if (!cached) {
                return undefined;
            }
            if (cached.expiresAt <= now()) {
                cache.delete(normalizedPath);
                return undefined;
            }
            touch(normalizedPath, cached);
            return cached.value;
        },
        invalidate(path) {
            const normalizedPath = normalizePath(path);
            if (!normalizedPath) {
                return;
            }
            cache.delete(normalizedPath);
            generations.set(
                normalizedPath,
                (generations.get(normalizedPath) ?? 0) + 1,
            );
            inFlight.delete(normalizedPath);
        },
        clear() {
            epoch += 1;
            cache.clear();
            inFlight.clear();
            generations.clear();
        },
    };
}

export const localFileExistsResolver = createPathValueResolver(
    async path => exists(path).catch(() => false),
    {
        maxConcurrent: 6,
        maxEntries: 4000,
        getTtlMs: fileExists => fileExists ? 60_000 : 10_000,
    },
);

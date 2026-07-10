import type { IPluginManager } from "@/types/core/pluginManager";
import type {
    IDownloadEnrichment,
    IDownloadMetadataConfig,
    IDownloadTaskMetadata,
    IMusicMetadata,
} from "@/types/metadata";
import { removeFileScheme } from "@/utils/fileUtils";
import { formatLyricsByTimestamp } from "@/utils/lrcParser";
import { errorLog } from "@/utils/log";
import { autoDecryptLyric } from "@/utils/musicDecrypter";
import Mp3Util, { isMp3UtilNativeMethodAvailable } from "@/native/mp3Util";
import {
    getLyricCandidateDistance,
    isLyricCandidateMatchAcceptable,
} from "./lyricSearchPolicy";
import { withTimeout } from "@/utils/promiseTimeout";

const METADATA_VERIFY_KEYS = ["title", "artist", "album"] as const;

export interface IMusicMetadataManagerOptions {
    enrichmentTimeoutMs?: number;
    pluginCallTimeoutMs?: number;
    nativeMetadataTimeoutMs?: number;
}

const DEFAULT_ENRICHMENT_TIMEOUT_MS = 15000;
const DEFAULT_PLUGIN_CALL_TIMEOUT_MS = 6000;
const DEFAULT_NATIVE_METADATA_TIMEOUT_MS = 20000;

export class MusicMetadataManager {
    private pluginManager: IPluginManager | null = null;
    private readonly enrichmentTimeoutMs: number;
    private readonly pluginCallTimeoutMs: number;
    private readonly nativeMetadataTimeoutMs: number;

    constructor(options: IMusicMetadataManagerOptions = {}) {
        this.enrichmentTimeoutMs =
            options.enrichmentTimeoutMs ?? DEFAULT_ENRICHMENT_TIMEOUT_MS;
        this.pluginCallTimeoutMs =
            options.pluginCallTimeoutMs ?? DEFAULT_PLUGIN_CALL_TIMEOUT_MS;
        this.nativeMetadataTimeoutMs =
            options.nativeMetadataTimeoutMs ??
            DEFAULT_NATIVE_METADATA_TIMEOUT_MS;
    }

    injectPluginManager(pluginManager: IPluginManager) {
        this.pluginManager = pluginManager;
    }

    isAvailable() {
        return isMp3UtilNativeMethodAvailable("setMediaTag");
    }

    private normalizeMetadataValue(value: unknown) {
        return value === undefined || value === null
            ? ""
            : String(value).trim();
    }

    private getRemainingTime(deadline: number) {
        return Math.max(0, deadline - Date.now());
    }

    private runWithDeadline<T>(
        operation: () => PromiseLike<T>,
        deadline: number,
        operationTimeoutMs: number,
        message: string,
    ) {
        const remaining = this.getRemainingTime(deadline);
        if (remaining <= 0) {
            return Promise.reject(new Error(message));
        }
        return withTimeout(
            Promise.resolve().then(operation),
            Math.min(remaining, operationTimeoutMs),
            message,
        );
    }

    private async verifyMetadataWrite(
        filePath: string,
        metadata: IMusicMetadata,
        deadline: number,
    ) {
        if (!isMp3UtilNativeMethodAvailable("getMediaTag")) {
            return true;
        }

        const expectedKeys = METADATA_VERIFY_KEYS.filter(
            key => this.normalizeMetadataValue(metadata[key]).length > 0,
        );
        if (!expectedKeys.length) {
            return true;
        }

        try {
            const writtenMetadata = await this.runWithDeadline(
                () => Mp3Util.getMediaTag(filePath),
                deadline,
                this.nativeMetadataTimeoutMs,
                "校验音乐元数据写入超时",
            );
            return expectedKeys.every(
                key =>
                    this.normalizeMetadataValue(writtenMetadata?.[key]) ===
                    this.normalizeMetadataValue(metadata[key]),
            );
        } catch (error) {
            errorLog("校验音乐元数据写入失败", {
                filePath,
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }

    private buildMetadataFromMusicItem(
        musicItem: IMusic.IMusicItem,
    ): IMusicMetadata {
        const metadata: IMusicMetadata = {
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album,
        };

        const comments: string[] = [];
        if (musicItem.alias) {
            comments.push(`别名: ${musicItem.alias}`);
        }
        if (musicItem.duration) {
            const minutes = Math.floor(musicItem.duration / 60);
            const seconds = Math.floor(musicItem.duration % 60);
            comments.push(
                `时长: ${minutes}:${seconds.toString().padStart(2, "0")}`,
            );
        }
        if (comments.length) {
            metadata.comment = comments.join(" | ");
        }

        return metadata;
    }

    private async getCoverUrl(
        musicItem: IMusic.IMusicItem,
        deadline: number,
    ): Promise<string | undefined> {
        if (typeof musicItem.artwork === "string" && musicItem.artwork.trim()) {
            return musicItem.artwork;
        }

        const plugin = this.pluginManager?.getByMedia(musicItem);
        if (!plugin?.methods.getMusicInfo) {
            return undefined;
        }

        const fullMusicInfo =
            await this.runWithDeadline<Partial<IMusic.IMusicItem> | null>(
                () => plugin.methods.getMusicInfo(musicItem),
                deadline,
                this.pluginCallTimeoutMs,
                "获取下载封面超时",
            ).catch(() => null);
        return fullMusicInfo?.artwork || undefined;
    }

    private async formatLyricSourceForDownload(
        lyricSource: ILyric.ILyricSource,
        config: IDownloadMetadataConfig,
        deadline: number,
    ): Promise<string | undefined> {
        const decrypt = (value: string, label: string) =>
            this.runWithDeadline(
                () => autoDecryptLyric(value, config.enableWordByWord),
                deadline,
                this.pluginCallTimeoutMs,
                label,
            );
        const rawLrc = lyricSource.rawLrc
            ? await decrypt(lyricSource.rawLrc, "解密下载歌词超时")
            : lyricSource.rawLrc;
        const translation = lyricSource.translation
            ? await decrypt(lyricSource.translation, "解密下载翻译歌词超时")
            : lyricSource.translation;
        const romanization = lyricSource.romanization
            ? await decrypt(lyricSource.romanization, "解密下载罗马音歌词超时")
            : lyricSource.romanization;

        if (!rawLrc) {
            if (lyricSource.lrc && !lyricSource.lrc.startsWith("http")) {
                return decrypt(lyricSource.lrc, "解密下载歌词超时");
            }
            return undefined;
        }

        return (
            formatLyricsByTimestamp(
                rawLrc,
                translation,
                romanization,
                config.lyricOrder,
                { enableWordByWord: config.enableWordByWord },
            ) || rawLrc
        );
    }

    private async getDirectLyricSource(
        musicItem: IMusic.IMusicItem,
        deadline: number,
    ): Promise<ILyric.ILyricSource | undefined> {
        if (musicItem.lyric) {
            return musicItem.lyric;
        }
        if (
            musicItem.rawLrc ||
            (musicItem.lrc && !musicItem.lrc.startsWith("http"))
        ) {
            return {
                rawLrc: musicItem.rawLrc,
                lrc: musicItem.lrc,
            };
        }

        const plugin = this.pluginManager?.getByMedia(musicItem);
        if (!plugin?.methods.getLyric) {
            return undefined;
        }

        return (
            (await this.runWithDeadline(
                () => plugin.methods.getLyric(musicItem),
                deadline,
                this.pluginCallTimeoutMs,
                "获取下载歌词超时",
            ).catch(() => null)) ?? undefined
        );
    }

    private async searchLyricSourceForDownload(
        musicItem: IMusic.IMusicItem,
        deadline: number,
    ): Promise<ILyric.ILyricSource | undefined> {
        const keyword = (musicItem.title || musicItem.alias || "").trim();
        if (!keyword) {
            return undefined;
        }

        const plugins =
            this.pluginManager?.getSortedSearchablePlugins("lyric") ?? [];
        let bestDistance = Infinity;
        let bestMusicItem: ILyric.ILyricItem | undefined;
        let bestPlugin: (typeof plugins)[number] | undefined;

        for (const plugin of plugins) {
            if (
                this.getRemainingTime(deadline) <= 0 ||
                !plugin.methods.search ||
                !plugin.methods.getLyric
            ) {
                continue;
            }

            const results = (await this.runWithDeadline(
                () => plugin.methods.search(keyword, 1, "lyric"),
                deadline,
                this.pluginCallTimeoutMs,
                "搜索下载歌词超时",
            ).catch(() => null)) as IPlugin.ISearchResult<"lyric"> | null;

            const candidates = results?.data?.slice(0, 2) ?? [];
            for (const item of candidates) {
                if (
                    !isLyricCandidateMatchAcceptable(keyword, musicItem, item)
                ) {
                    continue;
                }
                const distance = getLyricCandidateDistance(
                    keyword,
                    musicItem,
                    item,
                );
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestMusicItem = item;
                    bestPlugin = plugin;
                }
            }

            if (bestDistance === 0) {
                break;
            }
        }

        if (!bestMusicItem || !bestPlugin) {
            return undefined;
        }

        return (
            (await this.runWithDeadline(
                () => bestPlugin.methods.getLyric(bestMusicItem!),
                deadline,
                this.pluginCallTimeoutMs,
                "获取搜索到的下载歌词超时",
            ).catch(() => null)) ?? undefined
        );
    }

    async getLyricContentForDownload(
        musicItem: IMusic.IMusicItem,
        config: IDownloadMetadataConfig,
        deadline = Date.now() + this.enrichmentTimeoutMs,
    ): Promise<string | undefined> {
        const directLyricSource = await this.getDirectLyricSource(
            musicItem,
            deadline,
        );
        if (directLyricSource) {
            const directLyric = await this.formatLyricSourceForDownload(
                directLyricSource,
                config,
                deadline,
            ).catch(() => undefined);
            if (directLyric?.trim()) {
                return directLyric;
            }
        }

        const searchedLyricSource = await this.searchLyricSourceForDownload(
            musicItem,
            deadline,
        );
        return searchedLyricSource
            ? this.formatLyricSourceForDownload(
                searchedLyricSource,
                config,
                deadline,
            ).catch(() => undefined)
            : undefined;
    }

    async getDownloadEnrichment(
        musicItem: IMusic.IMusicItem,
        config: IDownloadMetadataConfig,
        preferredCoverUrl?: string,
    ): Promise<IDownloadEnrichment> {
        const deadline = Date.now() + this.enrichmentTimeoutMs;
        const shouldFetchLyric =
            config.writeLyric || config.downloadLyricFile === true;
        const shouldFetchCover = config.enabled && config.writeCover;

        const normalizedPreferredCoverUrl = preferredCoverUrl?.trim()
            ? preferredCoverUrl
            : undefined;
        const [lyricContent, coverUrl] = await Promise.all([
            shouldFetchLyric
                ? this.getLyricContentForDownload(
                    musicItem,
                    config,
                    deadline,
                ).catch(error => {
                    errorLog("下载歌词 enrichment 失败", {
                        title: musicItem.title,
                        error:
                              error instanceof Error
                                  ? error.message
                                  : String(error),
                    });
                    return undefined;
                })
                : Promise.resolve(undefined),
            shouldFetchCover
                ? normalizedPreferredCoverUrl
                    ? Promise.resolve(normalizedPreferredCoverUrl)
                    : this.getCoverUrl(musicItem, deadline).catch(error => {
                        errorLog("下载封面 enrichment 失败", {
                            title: musicItem.title,
                            error:
                                  error instanceof Error
                                      ? error.message
                                      : String(error),
                        });
                        return undefined;
                    })
                : Promise.resolve(undefined),
        ]);

        return { lyricContent, coverUrl };
    }

    async writeMetadataForDownloadTask(
        taskInfo: IDownloadTaskMetadata,
        config: IDownloadMetadataConfig,
        enrichment?: IDownloadEnrichment,
    ) {
        if (!config.enabled || !this.isAvailable()) {
            return false;
        }

        try {
            const cleanFilePath = removeFileScheme(taskInfo.filePath);
            const resolvedEnrichment =
                enrichment ??
                (await this.getDownloadEnrichment(
                    taskInfo.musicItem,
                    config,
                    taskInfo.coverUrl,
                ));
            const metadata = {
                ...this.buildMetadataFromMusicItem(taskInfo.musicItem),
                ...taskInfo.metadata,
            };

            if (config.writeLyric && resolvedEnrichment.lyricContent) {
                metadata.lyric = resolvedEnrichment.lyricContent;
            }

            const coverUrl = config.writeCover
                ? resolvedEnrichment.coverUrl
                : undefined;
            const deadline = Date.now() + this.nativeMetadataTimeoutMs;

            if (
                coverUrl &&
                isMp3UtilNativeMethodAvailable("setMediaTagWithCover")
            ) {
                try {
                    const success = await this.runWithDeadline(
                        () =>
                            Mp3Util.setMediaTagWithCover!(
                                cleanFilePath,
                                metadata,
                                coverUrl,
                            ),
                        deadline,
                        this.nativeMetadataTimeoutMs,
                        "写入带封面音乐元数据超时",
                    );
                    if (
                        success &&
                        (await this.verifyMetadataWrite(
                            cleanFilePath,
                            metadata,
                            deadline,
                        ))
                    ) {
                        return true;
                    }
                    errorLog("写入带封面音乐元数据失败，改为写入基础标签", {
                        filePath: taskInfo.filePath,
                        coverUrl,
                        reason: success
                            ? "metadata verification failed"
                            : "native returned false",
                    });
                } catch (coverError) {
                    errorLog("写入带封面音乐元数据失败，改为写入基础标签", {
                        filePath: taskInfo.filePath,
                        coverUrl,
                        error:
                            coverError instanceof Error
                                ? coverError.message
                                : String(coverError),
                    });
                }
            }

            const success = await this.runWithDeadline(
                () => Mp3Util.setMediaTag(cleanFilePath, metadata),
                deadline,
                this.nativeMetadataTimeoutMs,
                "写入基础音乐元数据超时",
            );
            if (!success) {
                errorLog("写入基础音乐元数据失败", {
                    filePath: taskInfo.filePath,
                    reason: "native returned false",
                });
                return false;
            }

            const verified = await this.verifyMetadataWrite(
                cleanFilePath,
                metadata,
                deadline,
            );
            if (!verified) {
                errorLog("写入基础音乐元数据后校验失败", {
                    filePath: taskInfo.filePath,
                    expectedMetadata: metadata,
                });
            }
            return verified;
        } catch (error) {
            errorLog("写入音乐元数据失败", {
                filePath: taskInfo.filePath,
                musicItem: {
                    title: taskInfo.musicItem.title,
                    artist: taskInfo.musicItem.artist,
                    platform: taskInfo.musicItem.platform,
                },
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }

    async writeCoverOnly(filePath: string, coverUrl: string) {
        if (!isMp3UtilNativeMethodAvailable("setMediaCover")) {
            return false;
        }

        try {
            return await withTimeout(
                Mp3Util.setMediaCover!(removeFileScheme(filePath), coverUrl),
                this.nativeMetadataTimeoutMs,
                "写入音乐封面超时",
            );
        } catch (error) {
            errorLog("写入音乐封面失败", { filePath, coverUrl, error });
            return false;
        }
    }

    async writeLyricOnly(filePath: string, lyricContent: string) {
        if (!this.isAvailable()) {
            return false;
        }

        try {
            return await withTimeout(
                Mp3Util.setMediaTag(removeFileScheme(filePath), {
                    lyric: lyricContent,
                }),
                this.nativeMetadataTimeoutMs,
                "写入歌词超时",
            );
        } catch (error) {
            errorLog("写入歌词失败", { filePath, error });
            return false;
        }
    }

    async readMetadata(filePath: string) {
        if (!isMp3UtilNativeMethodAvailable("getMediaTag")) {
            return null;
        }

        try {
            return await withTimeout(
                Mp3Util.getMediaTag(removeFileScheme(filePath)),
                this.nativeMetadataTimeoutMs,
                "读取音乐元数据超时",
            );
        } catch (error) {
            errorLog("读取音乐元数据失败", { filePath, error });
            return null;
        }
    }
}

const musicMetadataManager = new MusicMetadataManager();

export { musicMetadataManager };
export default musicMetadataManager;

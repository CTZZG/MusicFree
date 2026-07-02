import { IAppConfig } from "@/types/core/config";
import { ITrackPlayer } from "@/types/core/trackPlayer";
import { IInjectable } from "@/types/infra";
import LyricParser, { IParsedLrcItem } from "@/utils/lrcParser";
import { getMediaExtraProperty, patchMediaExtra } from "@/utils/mediaExtra";
import { isSameMediaItem } from "@/utils/mediaUtils";
import minDistance from "@/utils/minDistance";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { Plugin } from "./pluginManager";

import pathConst from "@/constants/pathConst";
import LyricUtil from "@/native/lyricUtil";
import { checkAndCreateDir } from "@/utils/fileUtils";
import { autoDecryptLyric } from "@/utils/musicDecrypter";
import CryptoJs from "crypto-js";
import { unlink, writeFile } from "react-native-fs";
import { TrackPlayerEvents } from "@/constants/trackPlayerConst";
import { IPluginManager } from "@/types/core/pluginManager";
import { makeMutable, type SharedValue } from "react-native-reanimated";

interface ILyricState {
    loading: boolean;
    lyrics: IParsedLrcItem[];
    hasTranslation: boolean;
    hasRomanization: boolean;
    meta?: Record<string, string>;
    source?: ILyricSourceStatus;
    emptyReason?: LyricEmptyReason;
}

type LyricSourceType = NonNullable<ILyric.ILyricSource["sourceType"]> | "none";
type LyricEmptyReason =
    | "no-current-music"
    | "plugin-not-found"
    | "plugin-not-supported"
    | "plugin-empty"
    | "auto-search-empty"
    | "parse-failed"
    | "timeout"
    | "unknown";

interface ILyricSourceStatus {
    type: LyricSourceType;
    pluginName?: string;
    title?: string;
}

type LyricLineType = "original" | "translation" | "romanization";
type LocalLyricType = "raw" | "translation" | "romanization";

const defaultLyricDisplayOrder: LyricLineType[] = [
    "original",
    "translation",
    "romanization",
];

const defaultLyricState: ILyricState = {
    loading: true,
    lyrics: [],
    hasTranslation: false,
    hasRomanization: false,
};

const lyricStateAtom = atom<ILyricState>(defaultLyricState);
const currentLyricItemAtom = atom<IParsedLrcItem | null>(null);
const currentPositionMsAtom = atom<number>(0);

let currentPositionMsShared: SharedValue<number> | null = null;
const LYRIC_REQUEST_TIMEOUT_MS = 25000;

export function getCurrentPositionMsShared() {
    if (!currentPositionMsShared) {
        currentPositionMsShared = makeMutable(0);
    }
    return currentPositionMsShared;
}

function withTimeout<T>(
    promise: T | Promise<T>,
    timeoutMs: number,
    message: string,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(message));
        }, timeoutMs);

        Promise.resolve(promise).then(
            result => {
                clearTimeout(timer);
                resolve(result);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

function isTimeoutError(err: any) {
    const message = `${err?.message ?? err ?? ""}`.toLowerCase();
    return message.includes("超时") || message.includes("timeout");
}

class LyricManager implements IInjectable {
    private trackPlayer!: ITrackPlayer;
    private appConfig!: IAppConfig;
    private pluginManager!: IPluginManager;

    private lyricParser: LyricParser | null = null;

    get currentLyricItem() {
        return getDefaultStore().get(currentLyricItemAtom);
    }

    get lyricState() {
        return getDefaultStore().get(lyricStateAtom);
    }

    injectDependencies(
        trackPlayerService: ITrackPlayer,
        appConfigService: IAppConfig,
        pluginManager: IPluginManager,
    ): void {
        this.trackPlayer = trackPlayerService;
        this.appConfig = appConfigService;
        this.pluginManager = pluginManager;
    }

    setup() {
        // 更新歌词
        this.trackPlayer.on(
            TrackPlayerEvents.CurrentMusicChanged,
            musicItem => {
                this.refreshLyric(true, true);

                if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
                    if (musicItem) {
                        LyricUtil.setStatusBarLyricText(
                            `${musicItem.title} - ${musicItem.artist}`,
                        );
                    } else {
                        LyricUtil.setStatusBarLyricText("MusicFree");
                    }
                }
                this.clearMediaNotificationLyricText();
            },
        );

        this.trackPlayer.playerAdapter.addEventListener("progress", evt => {
            const parser = this.lyricParser;
            const positionMs = evt.position * 1000;
            getDefaultStore().set(currentPositionMsAtom, positionMs);
            getCurrentPositionMsShared().value = positionMs;

            if (!parser || !this.trackPlayer.isCurrentMusic(parser.musicItem)) {
                return;
            }

            const currentLyricItem =
                getDefaultStore().get(currentLyricItemAtom);
            const newLyricItem = parser.getPosition(evt.position);

            if (currentLyricItem?.index !== newLyricItem?.index) {
                // 更新当前歌词状态
                getDefaultStore().set(
                    currentLyricItemAtom,
                    newLyricItem ?? null,
                );

                if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
                    LyricUtil.setStatusBarLyricText(
                        this.getStatusBarLyricText(newLyricItem) ||
                            (newLyricItem?.lrc ?? ""),
                    );
                }
                this.setMediaNotificationLyricText(
                    this.getStatusBarLyricText(newLyricItem) ||
                        (newLyricItem?.lrc ?? ""),
                );
            }
        });

        if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
            const statusBarLyricConfig = {
                topPercent: this.appConfig.getConfig("lyric.topPercent"),
                leftPercent: this.appConfig.getConfig("lyric.leftPercent"),
                align: this.appConfig.getConfig("lyric.align"),
                color: this.appConfig.getConfig("lyric.color"),
                backgroundColor: this.appConfig.getConfig(
                    "lyric.backgroundColor",
                ),
                widthPercent: this.appConfig.getConfig("lyric.widthPercent"),
                fontSize: this.appConfig.getConfig("lyric.fontSize"),
            };
            LyricUtil.showStatusBarLyric(
                "MusicFree",
                statusBarLyricConfig ?? {},
            );
        }

        this.refreshLyric(true);
    }

    private getLyricDisplayOrder() {
        const configuredOrder = this.appConfig.getConfig("basic.lyricOrder") ?? [];
        const displayOrder: LyricLineType[] = [];

        [...configuredOrder, ...defaultLyricDisplayOrder].forEach(type => {
            if (!displayOrder.includes(type)) {
                displayOrder.push(type);
            }
        });

        return displayOrder;
    }

    private getStatusBarLyricText(lyricItem: IParsedLrcItem | null | undefined) {
        if (!lyricItem) {
            return "";
        }

        const showTranslation =
            this.appConfig.getConfig("lyric.statusBarShowTranslation") ?? false;
        const showRomanization =
            this.appConfig.getConfig("lyric.statusBarShowRomanization") ?? false;
        const order = this.getLyricDisplayOrder();
        const lines: string[] = [];

        order.forEach(type => {
            if (type === "original" && lyricItem.lrc?.trim()) {
                lines.push(lyricItem.lrc);
            } else if (
                type === "translation" &&
                showTranslation &&
                lyricItem.translation?.trim()
            ) {
                lines.push(lyricItem.translation);
            } else if (
                type === "romanization" &&
                showRomanization &&
                lyricItem.romanization?.trim()
            ) {
                lines.push(lyricItem.romanization);
            }
        });

        return lines.join("\n");
    }

    private setMediaNotificationLyricText(lyric: string) {
        const text = lyric.trim();
        const showLiveUpdateLyric = this.appConfig.getConfig(
            "lyric.showLiveUpdateLyric",
        );
        if (
            this.appConfig.getConfig("lyric.showMediaNotificationLyric") &&
            !showLiveUpdateLyric
        ) {
            const task = text
                ? LyricUtil.setMediaNotificationLyricText?.(text)
                : LyricUtil.clearMediaNotificationLyricText?.();
            task?.catch(() => undefined);
        }
        if (showLiveUpdateLyric) {
            const task = text
                ? LyricUtil.setLiveUpdateLyricText?.(text)
                : LyricUtil.clearLiveUpdateLyricText?.();
            task?.catch(() => undefined);
        }
    }

    private clearMediaNotificationLyricText() {
        if (this.appConfig.getConfig("lyric.showMediaNotificationLyric")) {
            LyricUtil.clearMediaNotificationLyricText?.().catch(() => undefined);
        }
        if (this.appConfig.getConfig("lyric.showLiveUpdateLyric")) {
            LyricUtil.clearLiveUpdateLyricText?.().catch(() => undefined);
        }
    }

    refreshNativeNotificationLyric() {
        const currentLyric = getDefaultStore().get(currentLyricItemAtom);
        this.setMediaNotificationLyricText(
            currentLyric
                ? this.getStatusBarLyricText(currentLyric) ||
                      (currentLyric?.lrc ?? "")
                : "",
        );
    }

    associateLyric(
        musicItem: IMusic.IMusicItem,
        linkToMusicItem: ICommon.IMediaBase,
    ) {
        if (!musicItem || !linkToMusicItem) {
            return false;
        }

        // 如果当前音乐项和关联的音乐项相同，则不需要重新关联
        if (isSameMediaItem(musicItem, linkToMusicItem)) {
            patchMediaExtra(musicItem, {
                associatedLrc: undefined,
            });
            return false;
        } else {
            patchMediaExtra(musicItem, {
                associatedLrc: linkToMusicItem,
            });
            if (this.trackPlayer.isCurrentMusic(musicItem)) {
                this.refreshLyric(false);
            }
            return true;
        }
    }

    unassociateLyric(musicItem: IMusic.IMusicItem) {
        if (!musicItem) {
            return;
        }

        patchMediaExtra(musicItem, {
            associatedLrc: undefined,
        });

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(false);
        }
    }

    async uploadLocalLyric(
        musicItem: IMusic.IMusicItem,
        lyricContent: string,
        type: LocalLyricType = "raw",
    ) {
        if (!musicItem) {
            return;
        }

        const platformHash = CryptoJs.MD5(musicItem.platform).toString(
            CryptoJs.enc.Hex,
        );
        const idHash: string = CryptoJs.MD5(musicItem.id).toString(
            CryptoJs.enc.Hex,
        );

        // 检查是否缓存文件夹存在
        await checkAndCreateDir(pathConst.localLrcPath + platformHash);
        await writeFile(
            pathConst.localLrcPath +
                platformHash +
                "/" +
                idHash +
                (type === "raw"
                    ? ""
                    : type === "translation"
                        ? ".tran"
                        : ".roma") +
                ".lrc",
            lyricContent,
            "utf8",
        );

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(false, false);
        }
    }

    async removeLocalLyric(musicItem: IMusic.IMusicItem) {
        if (!musicItem) {
            return;
        }

        const platformHash = CryptoJs.MD5(musicItem.platform).toString(
            CryptoJs.enc.Hex,
        );
        const idHash: string = CryptoJs.MD5(musicItem.id).toString(
            CryptoJs.enc.Hex,
        );

        const basePath = pathConst.localLrcPath + platformHash + "/" + idHash;

        await unlink(basePath + ".lrc").catch(() => {});
        await unlink(basePath + ".tran.lrc").catch(() => {});
        await unlink(basePath + ".roma.lrc").catch(() => {});

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(false, false);
        }
    }

    updateLyricOffset(musicItem: IMusic.IMusicItem, offset: number) {
        if (!musicItem) {
            return;
        }

        // 更新歌词偏移
        patchMediaExtra(musicItem, {
            lyricOffset: offset,
        });

        if (this.trackPlayer.isCurrentMusic(musicItem)) {
            this.refreshLyric(true, false);
        }
    }

    private getLyricSourceStatus(
        lrcSource: ILyric.ILyricSource,
        musicItem: IMusic.IMusicItem,
        plugin?: Plugin,
        fallbackType: Exclude<LyricSourceType, "none"> = "plugin",
    ): ILyricSourceStatus {
        const associatedLrc = getMediaExtraProperty(musicItem, "associatedLrc");
        if (associatedLrc) {
            return {
                type: "associated",
                pluginName: associatedLrc.platform,
                title: associatedLrc.title,
            };
        }

        return {
            type: lrcSource.sourceType ?? fallbackType,
            pluginName:
                lrcSource.sourcePluginName ?? plugin?.name ?? musicItem.platform,
            title: lrcSource.sourceTitle ?? musicItem.title,
        };
    }

    private setLyricAsLoadingState(source?: ILyricSourceStatus) {
        getDefaultStore().set(lyricStateAtom, {
            loading: true,
            lyrics: [],
            hasTranslation: false,
            hasRomanization: false,
            source,
            emptyReason: undefined,
        });
        getDefaultStore().set(currentLyricItemAtom, null);
    }

    private setLyricAsNoLyricState(
        emptyReason: LyricEmptyReason = "unknown",
        source: ILyricSourceStatus = { type: "none" },
    ) {
        getDefaultStore().set(lyricStateAtom, {
            loading: false,
            lyrics: [],
            hasTranslation: false,
            hasRomanization: false,
            source,
            emptyReason,
        });
        getDefaultStore().set(currentLyricItemAtom, null);
        if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
            const musicItem = this.trackPlayer.currentMusic;
            LyricUtil.setStatusBarLyricText(
                musicItem
                    ? `${musicItem.title} - ${musicItem.artist}`
                    : "MusicFree",
            );
        }
        this.clearMediaNotificationLyricText();
    }

    private async refreshLyric(
        skipFetchLyricSourceIfSame: boolean = true,
        ignoreProgress: boolean = false,
    ) {
        const currentMusicItem = this.trackPlayer.currentMusic;

        // 如果没有当前音乐项，重置歌词状态
        if (!currentMusicItem) {
            this.setLyricAsNoLyricState("no-current-music");
            return;
        }

        try {
            let lrcSource: ILyric.ILyricSource | null;
            let sourceStatus: ILyricSourceStatus | undefined;
            let emptyReason: LyricEmptyReason = "plugin-empty";

            if (
                skipFetchLyricSourceIfSame &&
                this.lyricParser &&
                this.trackPlayer.isCurrentMusic(this.lyricParser.musicItem)
            ) {
                lrcSource = this.lyricParser.lyricSource ?? null;
                sourceStatus = this.lyricState.source;
            } else {
                // 重置歌词状态
                this.setLyricAsLoadingState();

                const plugin = this.pluginManager.getByMedia(currentMusicItem);
                if (!plugin) {
                    lrcSource = null;
                    emptyReason = "plugin-not-found";
                } else {
                    lrcSource = (await withTimeout(
                        plugin.methods.getLyric(currentMusicItem),
                        LYRIC_REQUEST_TIMEOUT_MS,
                        "获取歌词超时",
                    )) ?? null;

                    if (lrcSource) {
                        sourceStatus = this.getLyricSourceStatus(
                            lrcSource,
                            currentMusicItem,
                            plugin,
                        );
                    } else if (!plugin.supportedMethods.has("getLyric")) {
                        emptyReason = "plugin-not-supported";
                    } else {
                        emptyReason = "plugin-empty";
                    }
                }
            }

            // 切换到其他歌曲了, 直接返回
            if (!this.trackPlayer.isCurrentMusic(currentMusicItem)) {
                return;
            }

            // 如果歌词源不存在，并且开启自动搜索歌词
            if (
                !lrcSource &&
                this.appConfig.getConfig("lyric.autoSearchLyric")
            ) {
                // 重置歌词状态
                this.setLyricAsLoadingState({
                    type: "auto-search",
                    title: currentMusicItem.title,
                });

                lrcSource = await withTimeout(
                    this.searchSimilarLyric(currentMusicItem),
                    LYRIC_REQUEST_TIMEOUT_MS,
                    "自动搜索歌词超时",
                );
                if (lrcSource) {
                    sourceStatus = this.getLyricSourceStatus(
                        lrcSource,
                        currentMusicItem,
                        undefined,
                        "auto-search",
                    );
                } else {
                    emptyReason = "auto-search-empty";
                }
            }

            // 切换到其他歌曲了, 直接返回
            if (!this.trackPlayer.isCurrentMusic(currentMusicItem)) {
                return;
            }

            // 如果源不存在，恢复默认设置
            if (!lrcSource) {
                this.setLyricAsNoLyricState(emptyReason);
                this.lyricParser = null;
                return;
            }
            sourceStatus =
                sourceStatus ??
                this.getLyricSourceStatus(lrcSource, currentMusicItem);

            const enableWordByWord =
                this.appConfig.getConfig("lyric.enableWordByWord") ?? true;
            const rawLrc = lrcSource.rawLrc
                ? await autoDecryptLyric(lrcSource.rawLrc, enableWordByWord)
                : lrcSource.rawLrc;
            const translation = lrcSource.translation
                ? await autoDecryptLyric(
                    lrcSource.translation,
                    enableWordByWord,
                )
                : lrcSource.translation;
            const romanization = lrcSource.romanization
                ? await autoDecryptLyric(
                    lrcSource.romanization,
                    enableWordByWord,
                )
                : lrcSource.romanization;

            this.lyricParser = new LyricParser(rawLrc ?? "", {
                extra: {
                    offset:
                        (getMediaExtraProperty(
                            currentMusicItem,
                            "lyricOffset",
                        ) || 0) * -1,
                },
                musicItem: currentMusicItem,
                lyricSource: lrcSource,
                translation,
                romanization,
            });

            const lyricItems = this.lyricParser.getLyricItems();
            if (!lyricItems.length) {
                this.lyricParser = null;
                this.setLyricAsNoLyricState("parse-failed", sourceStatus);
                return;
            }

            getDefaultStore().set(lyricStateAtom, {
                loading: false,
                lyrics: lyricItems,
                hasTranslation: this.lyricParser.hasTranslation,
                hasRomanization: this.lyricParser.hasRomanization,
                meta: this.lyricParser.getMeta(),
                source: sourceStatus,
                emptyReason: undefined,
            });

            const progress = await this.trackPlayer.getProgress();
            const currentLyric = ignoreProgress
                ? lyricItems[0] ?? null
                : this.lyricParser.getPosition(progress.position);
            const positionMs = progress.position * 1000;
            getDefaultStore().set(currentPositionMsAtom, positionMs);
            getCurrentPositionMsShared().value = positionMs;
            getDefaultStore().set(currentLyricItemAtom, currentLyric || null);

            if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
                if (currentLyric) {
                    LyricUtil.setStatusBarLyricText(
                        this.getStatusBarLyricText(currentLyric) ||
                            (currentLyric?.lrc ?? ""),
                    );
                } else {
                    const musicItem = this.trackPlayer.currentMusic;
                    LyricUtil.setStatusBarLyricText(
                        musicItem
                            ? `${musicItem.title} - ${musicItem.artist}`
                            : "MusicFree",
                    );
                }
            }
            this.setMediaNotificationLyricText(
                currentLyric
                    ? this.getStatusBarLyricText(currentLyric) ||
                          (currentLyric?.lrc ?? "")
                    : "",
            );
        } catch (err) {
            if (this.trackPlayer.isCurrentMusic(currentMusicItem)) {
                this.lyricParser = null;
                this.setLyricAsNoLyricState(
                    isTimeoutError(err) ? "timeout" : "parse-failed",
                );
            }
        }
    }

    /**
     * 检索最接近的歌词
     * @param musicItem
     * @returns
     */
    private async searchSimilarLyric(
        musicItem: IMusic.IMusicItem,
    ): Promise<ILyric.ILyricSource | null> {
        const keyword = musicItem.alias || musicItem.title;
        const plugins = this.pluginManager.getSearchablePlugins("lyric");

        let distance = Infinity;
        let minDistanceMusicItem;
        let targetPlugin: Plugin | null = null;

        for (let plugin of plugins) {
            // 如果插件不是当前音乐的插件，或者当前音乐不是正在播放的音乐，则跳过
            if (!this.trackPlayer.isCurrentMusic(musicItem)) {
                return null;
            }

            if (plugin.name === musicItem.platform) {
                // 如果插件是当前音乐的插件，则跳过
                continue;
            }

            const results = (await withTimeout(
                plugin.methods.search(keyword, 1, "lyric"),
                LYRIC_REQUEST_TIMEOUT_MS,
                "搜索歌词超时",
            ).catch(() => null)) as IPlugin.ISearchResult<"lyric"> | null;

            // 取前两个
            const firstTwo = results?.data?.slice(0, 2) || [];

            for (let item of firstTwo) {
                if (
                    item.title === keyword &&
                    item.artist === musicItem.artist
                ) {
                    distance = 0;
                    minDistanceMusicItem = item;
                    targetPlugin = plugin;
                    break;
                } else {
                    const dist =
                        minDistance(keyword, musicItem.title) +
                        minDistance(item.artist, musicItem.artist);
                    if (dist < distance) {
                        distance = dist;
                        minDistanceMusicItem = item;
                        targetPlugin = plugin;
                    }
                }
            }

            if (distance === 0) {
                break;
            }
        }

        if (minDistanceMusicItem && targetPlugin) {
            const lrcSource = await withTimeout(
                targetPlugin.methods.getLyric(minDistanceMusicItem),
                LYRIC_REQUEST_TIMEOUT_MS,
                "获取匹配歌词超时",
            ).catch(() => null);
            return lrcSource
                ? {
                    ...lrcSource,
                    sourceType: "auto-search",
                    sourcePluginName: targetPlugin.name,
                    sourceTitle: minDistanceMusicItem.title,
                }
                : null;
        }

        return null;
    }
}

const lyricManager = new LyricManager();
export default lyricManager;

export const useLyricState = () => useAtomValue(lyricStateAtom);
export const useCurrentLyricItem = () => useAtomValue(currentLyricItemAtom);
export const useCurrentPositionMs = () => useAtomValue(currentPositionMsAtom);

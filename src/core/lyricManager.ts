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
import PersistStatus from "@/utils/persistStatus";
import {
    cancelAnimation,
    Easing,
    makeMutable,
    withTiming,
    type SharedValue,
} from "react-native-reanimated";

export interface ILyricState {
    loading: boolean;
    lyrics: IParsedLrcItem[];
    hasTranslation: boolean;
    hasRomanization: boolean;
    meta?: Record<string, string>;
    source?: ILyricSourceStatus;
    emptyReason?: LyricEmptyReason;
}

export type LyricSourceType =
    | NonNullable<ILyric.ILyricSource["sourceType"]>
    | "none";
export type LyricEmptyReason =
    | "no-current-music"
    | "plugin-not-found"
    | "plugin-not-supported"
    | "plugin-empty"
    | "auto-search-empty"
    | "parse-failed"
    | "timeout"
    | "unknown";

export interface ILyricSourceStatus {
    type: LyricSourceType;
    pluginName?: string;
    title?: string;
}

export type NativeLyricNotificationMode =
    | "none"
    | "media-notification"
    | "live-update";

export interface INativeLyricOutputState {
    text: string;
    statusBarText: string;
    notificationMode: NativeLyricNotificationMode;
    musicKey?: string;
    lyricIndex?: number;
    source?: ILyricSourceStatus;
    updatedAt: number;
}

export interface ILyricDiagnosticSnapshot {
    loading: boolean;
    lyricCount: number;
    hasTranslation: boolean;
    hasRomanization: boolean;
    emptyReason?: LyricEmptyReason;
    source?: ILyricSourceStatus;
    currentLyric: {
        index?: number;
        time?: number;
        text: string;
        hasTranslation: boolean;
        hasRomanization: boolean;
    } | null;
    positionMs: number;
    parserMusic: {
        title?: string;
        artist?: string;
        platform?: string;
    } | null;
    parserMatchesCurrentMusic: boolean;
    nativeOutput: INativeLyricOutputState;
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
const nativeLyricOutputAtom = atom<INativeLyricOutputState>({
    text: "",
    statusBarText: "MusicFree",
    notificationMode: "none",
    updatedAt: 0,
});

let currentPositionMsShared: SharedValue<number> | null = null;
const LYRIC_REQUEST_TIMEOUT_MS = 25000;
const POSITION_CLOCK_RUNWAY_MS = 60000;
const POSITION_CLOCK_RESYNC_INTERVAL_MS = 5000;
const POSITION_CLOCK_MAX_DRIFT_MS = 160;
const POSITION_CLOCK_CORRECTION_MS = 2000;

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
    private lastNativeLyricOutputSignature = "";
    private isPlaybackAdvancing = false;
    private lastProgressPositionMs = 0;
    private isPositionClockRunning = false;
    private positionClockRate = 1;
    private lastPositionClockSyncTime = 0;
    private positionClockCorrectionUntil = 0;

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

    private getPositionClockRate() {
        const persistedRate = Number(PersistStatus.get("music.rate") ?? 100) / 100;
        return Number.isFinite(persistedRate) && persistedRate > 0
            ? persistedRate
            : 1;
    }

    private stopPositionClock(positionMs: number) {
        const positionShared = getCurrentPositionMsShared();
        cancelAnimation(positionShared);
        positionShared.value = positionMs;
        this.isPositionClockRunning = false;
        this.lastPositionClockSyncTime = 0;
        this.positionClockCorrectionUntil = 0;
    }

    private syncPositionClock(positionMs: number, force = false) {
        if (!this.isPlaybackAdvancing) {
            this.stopPositionClock(positionMs);
            return;
        }

        const positionShared = getCurrentPositionMsShared();
        const now = Date.now();
        const rate = this.getPositionClockRate();

        if (force || !this.isPositionClockRunning) {
            cancelAnimation(positionShared);
            positionShared.value = positionMs;
            positionShared.value = withTiming(
                positionMs + POSITION_CLOCK_RUNWAY_MS * rate,
                {
                    duration: POSITION_CLOCK_RUNWAY_MS,
                    easing: Easing.linear,
                },
            );
            this.isPositionClockRunning = true;
            this.positionClockRate = rate;
            this.lastPositionClockSyncTime = now;
            this.positionClockCorrectionUntil = 0;
            return;
        }

        if (now < this.positionClockCorrectionUntil) {
            return;
        }

        if (this.positionClockCorrectionUntil > 0) {
            this.positionClockCorrectionUntil = 0;
            positionShared.value = withTiming(
                positionMs + POSITION_CLOCK_RUNWAY_MS * rate,
                {
                    duration: POSITION_CLOCK_RUNWAY_MS,
                    easing: Easing.linear,
                },
            );
            this.positionClockRate = rate;
            this.lastPositionClockSyncTime = now;
            return;
        }

        const rateChanged = Math.abs(rate - this.positionClockRate) > 0.001;
        const shouldResync =
            rateChanged ||
            now - this.lastPositionClockSyncTime >=
                POSITION_CLOCK_RESYNC_INTERVAL_MS;
        if (!shouldResync) {
            return;
        }

        const drift = positionMs - positionShared.value;
        if (Math.abs(drift) > POSITION_CLOCK_MAX_DRIFT_MS) {
            positionShared.value = withTiming(
                positionMs + POSITION_CLOCK_CORRECTION_MS * rate,
                {
                    duration: POSITION_CLOCK_CORRECTION_MS,
                    easing: Easing.linear,
                },
            );
            this.positionClockRate = rate;
            this.lastPositionClockSyncTime = now;
            this.positionClockCorrectionUntil =
                now + POSITION_CLOCK_CORRECTION_MS;
            return;
        }

        positionShared.value = withTiming(
            positionMs + POSITION_CLOCK_RUNWAY_MS * rate,
            {
                duration: POSITION_CLOCK_RUNWAY_MS,
                easing: Easing.linear,
            },
        );
        this.positionClockRate = rate;
        this.lastPositionClockSyncTime = now;
    }

    private updatePositionClockFromProgress(positionMs: number) {
        const isSeek =
            this.lastProgressPositionMs > 0 &&
            Math.abs(positionMs - this.lastProgressPositionMs) > 800;
        getDefaultStore().set(currentPositionMsAtom, positionMs);
        this.syncPositionClock(positionMs, isSeek);
        this.lastProgressPositionMs = positionMs;
    }

    setup() {
        // 更新歌词
        this.trackPlayer.on(TrackPlayerEvents.CurrentMusicChanged, () => {
            this.refreshLyric(true, true);
            this.publishNativeLyricOutput(null, { force: true });
        });

        this.trackPlayer.playerAdapter
            .getState()
            .then(state => {
                this.isPlaybackAdvancing = state === "playing";
            })
            .catch(() => undefined);

        this.trackPlayer.playerAdapter.addEventListener(
            "playbackStateChanged",
            state => {
                this.isPlaybackAdvancing = state === "playing";
                this.trackPlayer
                    .getProgress()
                    .then(progress => {
                        const positionMs = progress.position * 1000;
                        getDefaultStore().set(
                            currentPositionMsAtom,
                            positionMs,
                        );
                        if (this.isPlaybackAdvancing) {
                            this.syncPositionClock(positionMs, true);
                        } else {
                            this.stopPositionClock(positionMs);
                        }
                        this.lastProgressPositionMs = positionMs;
                    })
                    .catch(() => undefined);
            },
        );

        this.trackPlayer.playerAdapter.addEventListener(
            "playbackSeeked",
            evt => {
                const positionMs = (evt?.position ?? 0) * 1000;
                getDefaultStore().set(currentPositionMsAtom, positionMs);
                this.syncPositionClock(positionMs, true);
                this.lastProgressPositionMs = positionMs;
            },
        );

        this.trackPlayer.playerAdapter.addEventListener("progress", evt => {
            const parser = this.lyricParser;
            const positionMs = evt.position * 1000;
            this.updatePositionClockFromProgress(positionMs);

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

                this.publishNativeLyricOutput(newLyricItem);
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
        const configuredOrder =
            this.appConfig.getConfig("basic.lyricOrder") ?? [];
        const displayOrder: LyricLineType[] = [];

        [...configuredOrder, ...defaultLyricDisplayOrder].forEach(type => {
            if (!displayOrder.includes(type)) {
                displayOrder.push(type);
            }
        });

        return displayOrder;
    }

    private getStatusBarLyricText(
        lyricItem: IParsedLrcItem | null | undefined,
    ) {
        if (!lyricItem) {
            return "";
        }

        const showTranslation =
            this.appConfig.getConfig("lyric.statusBarShowTranslation") ?? false;
        const showRomanization =
            this.appConfig.getConfig("lyric.statusBarShowRomanization") ??
            false;
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

    private getNativeLyricFallbackText() {
        const musicItem = this.trackPlayer.currentMusic;
        return musicItem
            ? `${musicItem.title} - ${musicItem.artist}`
            : "MusicFree";
    }

    private getNativeLyricText(lyricItem: IParsedLrcItem | null | undefined) {
        return (
            this.getStatusBarLyricText(lyricItem) ||
            (lyricItem?.lrc ?? "")
        ).trim();
    }

    private getNativeNotificationMode(
        text: string,
    ): NativeLyricNotificationMode {
        if (!text) {
            return "none";
        }
        if (this.appConfig.getConfig("lyric.showLiveUpdateLyric")) {
            return "live-update";
        }
        if (this.appConfig.getConfig("lyric.showMediaNotificationLyric")) {
            return "media-notification";
        }
        return "none";
    }

    private publishNativeLyricOutput(
        lyricItem: IParsedLrcItem | null | undefined,
        options: {force?: boolean} = {},
    ) {
        const text = this.getNativeLyricText(lyricItem);
        const statusBarText = text || this.getNativeLyricFallbackText();
        const musicItem = this.trackPlayer.currentMusic;
        const output: INativeLyricOutputState = {
            text,
            statusBarText,
            notificationMode: this.getNativeNotificationMode(text),
            musicKey: musicItem
                ? `${musicItem.platform}@${musicItem.id}`
                : undefined,
            lyricIndex: lyricItem?.index,
            source: this.lyricState.source,
            updatedAt: Date.now(),
        };
        const previousOutput = getDefaultStore().get(nativeLyricOutputAtom);
        const signature = [
            this.appConfig.getConfig("lyric.showStatusBarLyric")
                ? statusBarText
                : "",
            output.notificationMode,
            text,
            output.musicKey ?? "",
            output.lyricIndex ?? "",
        ].join("\u0000");

        if (
            !options.force &&
            signature === this.lastNativeLyricOutputSignature
        ) {
            return;
        }

        this.lastNativeLyricOutputSignature = signature;
        getDefaultStore().set(nativeLyricOutputAtom, output);

        if (this.appConfig.getConfig("lyric.showStatusBarLyric")) {
            LyricUtil.setStatusBarLyricText(statusBarText).catch(
                () => undefined,
            );
        }

        if (
            previousOutput.notificationMode === "media-notification" &&
            output.notificationMode !== "media-notification"
        ) {
            LyricUtil.clearMediaNotificationLyricText?.().catch(
                () => undefined,
            );
        }
        if (
            previousOutput.notificationMode === "live-update" &&
            output.notificationMode !== "live-update"
        ) {
            LyricUtil.clearLiveUpdateLyricText?.().catch(() => undefined);
        }

        if (output.notificationMode === "media-notification") {
            LyricUtil.setMediaNotificationLyricText?.(text).catch(
                () => undefined,
            );
        } else if (output.notificationMode === "live-update") {
            LyricUtil.setLiveUpdateLyricText?.(text).catch(() => undefined);
        } else if (options.force) {
            LyricUtil.clearMediaNotificationLyricText?.().catch(
                () => undefined,
            );
            LyricUtil.clearLiveUpdateLyricText?.().catch(() => undefined);
        }
    }

    refreshNativeNotificationLyric() {
        const currentLyric = getDefaultStore().get(currentLyricItemAtom);
        this.publishNativeLyricOutput(currentLyric, { force: true });
    }

    getLyricDiagnosticSnapshot(): ILyricDiagnosticSnapshot {
        const lyricState = getDefaultStore().get(lyricStateAtom);
        const currentLyric = getDefaultStore().get(currentLyricItemAtom);
        const parserMusicItem = this.lyricParser?.musicItem ?? null;

        return {
            loading: lyricState.loading,
            lyricCount: lyricState.lyrics.length,
            hasTranslation: lyricState.hasTranslation,
            hasRomanization: lyricState.hasRomanization,
            emptyReason: lyricState.emptyReason,
            source: lyricState.source,
            currentLyric: currentLyric
                ? {
                    index: currentLyric.index,
                    time: currentLyric.time,
                    text: this.getNativeLyricText(currentLyric),
                    hasTranslation: !!currentLyric.translation?.trim(),
                    hasRomanization: !!currentLyric.romanization?.trim(),
                }
                : null,
            positionMs: getDefaultStore().get(currentPositionMsAtom),
            parserMusic: parserMusicItem
                ? {
                    title: parserMusicItem.title,
                    artist: parserMusicItem.artist,
                    platform: parserMusicItem.platform,
                }
                : null,
            parserMatchesCurrentMusic: parserMusicItem
                ? this.trackPlayer.isCurrentMusic(parserMusicItem)
                : false,
            nativeOutput: {
                ...getDefaultStore().get(nativeLyricOutputAtom),
            },
        };
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
                lrcSource.sourcePluginName ??
                plugin?.name ??
                musicItem.platform,
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
        this.publishNativeLyricOutput(null, { force: true });
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
                    lrcSource =
                        (await withTimeout(
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
            this.updatePositionClockFromProgress(positionMs);
            getDefaultStore().set(currentLyricItemAtom, currentLyric || null);

            this.publishNativeLyricOutput(currentLyric, { force: true });
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
export const useNativeLyricOutput = () => useAtomValue(nativeLyricOutputAtom);

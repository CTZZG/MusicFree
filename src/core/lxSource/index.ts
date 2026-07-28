import CryptoJs from "crypto-js";
import EventEmitter from "eventemitter3";
import { readAsStringAsync } from "expo-file-system/legacy";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { readFile } from "react-native-fs";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import { createReachableMediaSourceHeaders } from "./headers";
import { devLog, errorLog, trace } from "@/utils/log";
import { parseLxSourceMetadata } from "./metadata";
import {
    convertMusicFreeItemToLxMusicInfo,
    mapMusicFreeQualityToLx,
} from "./platform";
import {
    createLxSourceRuntime,
    requestLxMusicUrl,
    setLxAllowInsecureHttp,
} from "./runtime";
import { validateRemoteMediaUrl } from "./mediaUrl";
import { downloadRemoteLxSource } from "./remoteSource";
import { createRestrictedHttpClient } from "@/utils/restrictedHttpClient";
import Config from "@/core/appConfig";
import {
    isMediaHttpAllowed,
    isPluginInsecureHttpAllowed,
} from "@/utils/mediaHttpCompatibilityPolicy";
import {
    classifyMediaSourceFailure,
    createMediaSourceFailureResult,
    mediaSourceFailureFromPluginResult,
    preferMediaSourceFailure,
    type MediaSourceFailure,
} from "@/core/pluginManager/mediaSourceFailure";

// runtime.ts 刻意不依赖 appConfig，这里把明文开关注入进去。
setLxAllowInsecureHttp(() => isPluginInsecureHttpAllowed(Config));
import {
    ILxSourceInstallResult,
    ILxSourceItem,
    ILxSourceKey,
    ILxSourceRedirectTarget,
    ILxSourceRuntime,
} from "./types";

const store = getOrCreateMMKV("lx-source");
const mediaProbeHttpClient = createRestrictedHttpClient({
    maxResponseBytes: 64 * 1024,
    maxTimeoutMs: 8_000,
});
const storageKey = "sources";
const redirectTargetPrefix = "lx-source:";
const lxSourceKeys: ILxSourceKey[] = ["kw", "kg", "tx", "wy", "mg", "local"];
const lxSourceKeyLabels: Record<ILxSourceKey, string> = {
    kw: "酷我音乐",
    kg: "酷狗音乐",
    tx: "QQ音乐",
    wy: "网易云音乐",
    mg: "咪咕音乐",
    local: "本地音乐",
};
const sourcesAtom = atom<ILxSourceItem[]>([]);
const ee = new EventEmitter<{
    updated: () => void;
}>();

function hashScript(script: string) {
    return CryptoJs.SHA256(script).toString(CryptoJs.enc.Hex);
}

function getStoredSources() {
    const sources = safeParse<ILxSourceItem[]>(store.getString(storageKey));
    return Array.isArray(sources) ? sources : [];
}

function setStoredSources(sources: ILxSourceItem[]) {
    store.set(storageKey, JSON.stringify(sources));
    getDefaultStore().set(sourcesAtom, sources);
    ee.emit("updated");
}

function createFailure(message: string): ILxSourceInstallResult {
    return {
        success: false,
        message,
    };
}

function getCacheKey(item: ILxSourceItem) {
    return `${item.id}:${item.updatedAt}`;
}

export function encodeLxSourceRedirectTarget(
    sourceId: string,
    sourceKey: ILxSourceKey,
) {
    return `${redirectTargetPrefix}${sourceId}:${sourceKey}`;
}

export function parseLxSourceRedirectTarget(target?: string | null) {
    if (!target?.startsWith(redirectTargetPrefix)) {
        return null;
    }

    const body = target.slice(redirectTargetPrefix.length);
    const [sourceId, sourceKey, ...rest] = body.split(":");
    if (
        !sourceId ||
        rest.length ||
        !lxSourceKeys.includes(sourceKey as ILxSourceKey)
    ) {
        return null;
    }

    return {
        sourceId,
        sourceKey: sourceKey as ILxSourceKey,
    };
}

export function isLxSourceRedirectTarget(target?: string | null) {
    return Boolean(parseLxSourceRedirectTarget(target));
}

async function isReachableMediaSource(result: IPlugin.IMediaSourceResult) {
    if (!result.url) {
        return false;
    }

    try {
        const response = await mediaProbeHttpClient.get(result.url, {
            headers: createReachableMediaSourceHeaders(result),
            responseType: "arraybuffer",
            timeout: 8000,
            validateStatus: status => status >= 200 && status < 400,
        });
        const contentType = String(response.headers?.["content-type"] ?? "");
        return !/^text\/html\b/i.test(contentType);
    } catch {
        return false;
    }
}

class LxSourceManager {
    private runtimeCache = new Map<string, ILxSourceRuntime>();

    setup() {
        getDefaultStore().set(sourcesAtom, getStoredSources());
    }

    getSources() {
        return getDefaultStore().get(sourcesAtom);
    }

    private setSources(sources: ILxSourceItem[]) {
        setStoredSources(sources);
    }

    private async createItem(
        script: string,
        sourceInfo?: {
            sourceUrl?: string;
            localPath?: string;
        },
    ): Promise<ILxSourceInstallResult> {
        let metadata;
        try {
            metadata = parseLxSourceMetadata(script);
        } catch (e: any) {
            return createFailure(e?.message ?? "LX custom source metadata parse failed");
        }

        let runtime: ILxSourceRuntime;
        try {
            runtime = await createLxSourceRuntime(script, metadata);
        } catch (e: any) {
            return createFailure(e?.message ?? "LX custom source parse failed");
        }

        const now = Date.now();
        const id = hashScript(script);
        const sources = this.getSources();
        const oldItem = sources.find(item =>
            item.id === id || item.metadata.name === metadata.name,
        );
        const item: ILxSourceItem = {
            id,
            enabled: oldItem?.enabled ?? true,
            script,
            metadata,
            sourceUrl: sourceInfo?.sourceUrl ?? oldItem?.sourceUrl,
            localPath: sourceInfo?.localPath ?? oldItem?.localPath,
            sources: runtime.sources,
            installedAt: oldItem?.installedAt ?? now,
            updatedAt: now,
        };

        const nextSources = oldItem
            ? sources.map(source => source === oldItem ? item : source)
            : sources.concat(item);

        this.runtimeCache.set(getCacheKey(item), runtime);
        this.setSources(nextSources);

        return {
            success: true,
            item,
        };
    }

    async installFromUrl(url: string): Promise<ILxSourceInstallResult> {
        try {
            const remoteSource = await downloadRemoteLxSource(url);
            return this.createItem(remoteSource.script, {
                sourceUrl: remoteSource.sourceUrl,
            });
        } catch (e: any) {
            devLog("error", "LX custom source install from URL failed", e?.message ?? e);
            return createFailure(e?.message ?? "LX custom source download failed");
        }
    }

    async installFromLocalFile(
        filePath: string,
        config?: {
            useExpoFs?: boolean;
        },
    ): Promise<ILxSourceInstallResult> {
        try {
            const script = config?.useExpoFs
                ? await readAsStringAsync(filePath)
                : await readFile(filePath, "utf8");
            return this.createItem(script, {
                localPath: filePath,
            });
        } catch (e: any) {
            devLog("error", "LX custom source install from local file failed", e?.message ?? e);
            return createFailure(e?.message ?? "LX custom source file read failed");
        }
    }

    async updateSource(id: string): Promise<ILxSourceInstallResult> {
        const item = this.getSources().find(source => source.id === id);
        if (!item) {
            return createFailure("LX custom source not found");
        }
        if (!item.sourceUrl) {
            return createFailure("LX custom source has no update URL");
        }
        return this.installFromUrl(item.sourceUrl);
    }

    deleteSource(id: string) {
        this.runtimeCache.clear();
        this.setSources(this.getSources().filter(item => item.id !== id));
    }

    setEnabled(id: string, enabled: boolean) {
        this.setSources(
            this.getSources().map(item =>
                item.id === id
                    ? {
                        ...item,
                        enabled,
                    }
                    : item,
            ),
        );
    }

    private async getRuntime(item: ILxSourceItem) {
        const cacheKey = getCacheKey(item);
        const cached = this.runtimeCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const runtime = await createLxSourceRuntime(item.script, item.metadata);
        this.runtimeCache.set(cacheKey, runtime);
        return runtime;
    }

    isRedirectTarget(target?: string | null) {
        return isLxSourceRedirectTarget(target);
    }

    private getSourceDisplayName(item: ILxSourceItem, sourceKey: ILxSourceKey) {
        return item.sources?.[sourceKey]?.name ?? lxSourceKeyLabels[sourceKey];
    }

    private sourceSupportsMusicUrl(item: ILxSourceItem, sourceKey: ILxSourceKey) {
        const sourceInfo = item.sources?.[sourceKey];
        return Boolean(
            sourceInfo &&
            Array.isArray(sourceInfo.actions) &&
            sourceInfo.actions.includes("musicUrl"),
        );
    }

    private createRedirectTarget(
        item: ILxSourceItem,
        sourceKey: ILxSourceKey,
    ): ILxSourceRedirectTarget {
        return {
            value: encodeLxSourceRedirectTarget(item.id, sourceKey),
            sourceId: item.id,
            sourceKey,
            sourceName: this.getSourceDisplayName(item, sourceKey),
            item,
        };
    }

    getRedirectTargets() {
        const targets: ILxSourceRedirectTarget[] = [];
        this.getSources()
            .filter(item => item.enabled)
            .forEach(item => {
                lxSourceKeys.forEach(sourceKey => {
                    if (this.sourceSupportsMusicUrl(item, sourceKey)) {
                        targets.push(this.createRedirectTarget(item, sourceKey));
                    }
                });
            });
        return targets;
    }

    getRedirectTarget(target?: string | null) {
        const parsed = parseLxSourceRedirectTarget(target);
        if (!parsed) {
            return null;
        }

        const item = this.getSources().find(source => source.id === parsed.sourceId);
        if (!item) {
            return null;
        }

        return this.createRedirectTarget(item, parsed.sourceKey);
    }

    private resolveRequestQuality(
        sourceInfo: ILxSourceRuntime["sources"][ILxSourceKey],
        sourceKey: ILxSourceKey,
        quality: IMusic.IQualityKey,
    ) {
        if (sourceKey === "local") {
            return null;
        }

        const lxQuality = mapMusicFreeQualityToLx(quality);
        if (!sourceInfo?.qualitys?.length || sourceInfo.qualitys.includes(lxQuality)) {
            return lxQuality;
        }

        return sourceInfo.qualitys[0] ?? lxQuality;
    }

    private async requestMediaSourceFromItem(
        item: ILxSourceItem,
        sourceKey: ILxSourceKey,
        musicItem: IMusic.IMusicItemBase,
        quality: IMusic.IQualityKey,
        options?: {
            probeUrl?: boolean;
        },
    ) {
        if (!this.sourceSupportsMusicUrl(item, sourceKey)) {
            return null;
        }

        const musicInfo = convertMusicFreeItemToLxMusicInfo(musicItem, sourceKey);
        if (!musicInfo) {
            return null;
        }

        const runtime = await this.getRuntime(item);
        const runtimeSourceInfo = runtime.sources?.[sourceKey];
        if (
            !runtimeSourceInfo ||
            !Array.isArray(runtimeSourceInfo.actions) ||
            !runtimeSourceInfo.actions.includes("musicUrl")
        ) {
            return null;
        }

        const requestQuality = this.resolveRequestQuality(
            runtimeSourceInfo,
            sourceKey,
            quality,
        );
        const result = await requestLxMusicUrl(runtime, {
            source: sourceKey,
            action: "musicUrl",
            info: {
                type: requestQuality,
                musicInfo: {
                    ...musicInfo,
                    source: sourceKey,
                },
            },
        });

        const mediaUrl = validateRemoteMediaUrl(result?.url, {
            allowHttp: isMediaHttpAllowed(Config),
        });
        if (!mediaUrl.ok) {
            trace(
                "播放",
                `LX自定义源返回无效链接: ${item.metadata.name}`,
                "error",
            );
            return createMediaSourceFailureResult(
                classifyMediaSourceFailure(
                    new Error(mediaUrl.reason),
                    {
                        pluginName: `LX:${item.metadata.name}`,
                        quality,
                    },
                ),
            );
        }
        const normalizedResult = {
            ...result,
            url: mediaUrl.url,
        };
        if (
            options?.probeUrl &&
            new URL(normalizedResult.url).protocol === "https:" &&
            !await isReachableMediaSource(normalizedResult)
        ) {
            trace("播放", `LX自定义源链接不可用: ${item.metadata.name}`, "error");
            return null;
        }

        trace("播放", `LX自定义源解析: ${item.metadata.name}`);
        return {
            ...normalizedResult,
            quality: normalizedResult.quality ??
                requestQuality ??
                mapMusicFreeQualityToLx(quality),
        };
    }

    async getMediaSourceByRedirectTarget(
        target: string,
        musicItem: IMusic.IMusicItemBase,
        quality: IMusic.IQualityKey,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        const parsed = parseLxSourceRedirectTarget(target);
        if (!parsed) {
            return null;
        }

        const item = this.getSources().find(source =>
            source.id === parsed.sourceId && source.enabled,
        );
        if (!item) {
            return null;
        }

        try {
            return await this.requestMediaSourceFromItem(
                item,
                parsed.sourceKey,
                musicItem,
                quality,
            );
        } catch (e: any) {
            errorLog("LX自定义源重定向解析失败", {
                name: item.metadata.name,
                source: parsed.sourceKey,
                message: e?.message ?? String(e),
            });
            return createMediaSourceFailureResult(
                classifyMediaSourceFailure(e, {
                    mediaKey: getMediaUniqueKey(musicItem),
                    pluginName: `LX:${item.metadata.name}`,
                    quality,
                }),
            );
        }
    }

    async getMediaSource(
        musicItem: IMusic.IMusicItemBase,
        quality: IMusic.IQualityKey,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        const musicInfo = convertMusicFreeItemToLxMusicInfo(musicItem);
        if (!musicInfo) {
            return null;
        }

        const enabledSources = this.getSources().filter(item => item.enabled);
        let preferredFailure: MediaSourceFailure | null = null;
        for (const item of enabledSources) {
            const failureContext = {
                mediaKey: getMediaUniqueKey(musicItem),
                pluginName: `LX:${item.metadata.name}`,
                quality,
            };
            try {
                const result = await this.requestMediaSourceFromItem(
                    item,
                    musicInfo.source,
                    musicItem,
                    quality,
                    {
                        probeUrl: true,
                    },
                );
                if (result?.url) {
                    return result;
                }
                if (result?.failure) {
                    preferredFailure = preferMediaSourceFailure(
                        preferredFailure,
                        mediaSourceFailureFromPluginResult(
                            result.failure,
                            failureContext,
                        ),
                    );
                }
            } catch (e: any) {
                preferredFailure = preferMediaSourceFailure(
                    preferredFailure,
                    classifyMediaSourceFailure(e, failureContext),
                );
                errorLog("LX自定义源解析失败", {
                    name: item.metadata.name,
                    message: e?.message ?? String(e),
                });
            }
        }

        return preferredFailure
            ? createMediaSourceFailureResult(preferredFailure)
            : null;
    }
}

const lxSourceManager = new LxSourceManager();
lxSourceManager.setup();

export function useLxSources() {
    const sources = useAtomValue(sourcesAtom);
    const [stateSources, setStateSources] = useState(sources);

    useEffect(() => {
        const callback = () => {
            setStateSources(lxSourceManager.getSources());
        };
        ee.on("updated", callback);
        callback();
        return () => {
            ee.off("updated", callback);
        };
    }, [sources]);

    return stateSources;
}

export * from "./platform";
export * from "./types";
export default lxSourceManager;

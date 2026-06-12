import axios from "axios";
import CryptoJs from "crypto-js";
import EventEmitter from "eventemitter3";
import { readAsStringAsync } from "expo-file-system/legacy";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { readFile } from "react-native-fs";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse } from "@/utils/jsonUtil";
import { devLog, errorLog, trace } from "@/utils/log";
import { parseLxSourceMetadata } from "./metadata";
import {
    convertMusicFreeItemToLxMusicInfo,
    mapMusicFreeQualityToLx,
} from "./platform";
import { createLxSourceRuntime, requestLxMusicUrl } from "./runtime";
import {
    ILxSourceInstallResult,
    ILxSourceItem,
    ILxSourceRuntime,
} from "./types";

const store = getOrCreateMMKV("lx-source");
const storageKey = "sources";
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
            const response = await axios.get(url, {
                headers: {
                    "Cache-Control": "no-cache",
                    Pragma: "no-cache",
                    Expires: "0",
                },
                transformResponse: data => data,
            });
            return this.createItem(String(response.data ?? ""), {
                sourceUrl: url,
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

    async getMediaSource(
        musicItem: IMusic.IMusicItemBase,
        quality: IMusic.IQualityKey,
    ): Promise<IPlugin.IMediaSourceResult | null> {
        const musicInfo = convertMusicFreeItemToLxMusicInfo(musicItem);
        if (!musicInfo) {
            return null;
        }

        const lxQuality = mapMusicFreeQualityToLx(quality);
        const requestQuality = musicInfo.source === "local" ? null : lxQuality;
        const enabledSources = this.getSources().filter(item => item.enabled);
        for (const item of enabledSources) {
            const sourceInfo = item.sources?.[musicInfo.source];
            if (
                sourceInfo &&
                Array.isArray(sourceInfo.actions) &&
                !sourceInfo.actions.includes("musicUrl")
            ) {
                continue;
            }
            if (
                requestQuality &&
                sourceInfo?.qualitys?.length &&
                !sourceInfo.qualitys.includes(requestQuality)
            ) {
                continue;
            }

            try {
                const runtime = await this.getRuntime(item);
                const runtimeSourceInfo = runtime.sources?.[musicInfo.source];
                if (
                    runtimeSourceInfo &&
                    Array.isArray(runtimeSourceInfo.actions) &&
                    !runtimeSourceInfo.actions.includes("musicUrl")
                ) {
                    continue;
                }

                const result = await requestLxMusicUrl(runtime, {
                    source: musicInfo.source,
                    action: "musicUrl",
                    info: {
                        type: requestQuality,
                        musicInfo,
                    },
                });
                if (result?.url) {
                    trace("播放", `LX自定义源解析: ${item.metadata.name}`);
                    return {
                        ...result,
                        quality: result.quality ?? lxQuality,
                    };
                }
            } catch (e: any) {
                errorLog("LX自定义源解析失败", {
                    name: item.metadata.name,
                    message: e?.message ?? String(e),
                });
            }
        }

        return null;
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

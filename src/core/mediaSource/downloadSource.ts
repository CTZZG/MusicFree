import type { IPluginManager } from "@/types/core/pluginManager";
import { isTimeoutError, TimeoutError, withTimeout } from "@/utils/promiseTimeout";
import { selectDownloadSourceEncryption } from "../downloadMediaDecryption";
import { getRememberedAlternate } from "./alternateSource";
import { resolveMediaSourceCandidate } from "./resolveCandidate";

export interface DownloadSourceIdentity {
    kind: "original" | "direct" | "remembered";
    platform: string;
    id: string;
    quality?: IMusic.IQualityKey;
}

export const downloadSourceBudgetMs = 15_000;
export const downloadSourceCallTimeoutMs = 6_000;

/** Resolves raw media; playback proxies and download finalization stay with their owners. */
export async function resolveDownloadMediaSource<T extends IPlugin.IMediaSourceResult>(options: {
    musicItem: IMusic.IMusicItem;
    qualityOrder: IMusic.IQualityKey[];
    pluginManager: Pick<IPluginManager, "getByName" | "getByMedia" | "isPluginEnabled">;
    useRemembered: boolean;
    isActive: () => boolean;
    prepare: (source: IPlugin.IMediaSourceResult, remainingMs: number) => Promise<T | null>;
}): Promise<{ source: T; identity: DownloadSourceIdentity } | null> {
    const { musicItem, pluginManager, isActive } = options;
    const deadline = Date.now() + downloadSourceBudgetMs;
    const remembered = options.useRemembered ? getRememberedAlternate(musicItem) : null;
    const alternatePlugin = remembered ? pluginManager.getByMedia(remembered) : null;
    const hasAlternate = alternatePlugin && pluginManager.isPluginEnabled(alternatePlugin);
    // Reserve one bounded call for a usable remembered source. All probes share the same deadline.
    const originalDeadline = deadline - (hasAlternate ? downloadSourceCallTimeoutMs : 0);
    const remaining = (until: number) => Math.max(0, until - Date.now());
    const result = (source: T, item: IMusic.IMusicItem, kind: DownloadSourceIdentity["kind"], quality?: IMusic.IQualityKey) => ({
        source,
        identity: { kind, platform: item.platform, id: item.id, ...(quality ? { quality } : {}) },
    });
    const resolve = async (item: IMusic.IMusicItem, plugin: ReturnType<IPluginManager["getByName"]>, until: number, candidateActive = isActive) => {
        if (!plugin || !candidateActive()) {
            return null;
        }
        return resolveMediaSourceCandidate({
            musicItem: item,
            pluginName: plugin.name,
            qualityOrder: options.qualityOrder,
            isActive: candidateActive,
            isTimeout: isTimeoutError,
            request: quality => {
                const budget = remaining(until);
                if (budget <= 0) {
                    throw new TimeoutError("获取下载媒体源超时");
                }
                return withTimeout(
                    Promise.resolve().then(() => plugin.methods.getMediaSource(item, quality, 1, true)),
                    Math.min(budget, downloadSourceCallTimeoutMs),
                    "获取下载媒体源超时",
                );
            },
            prepare: (raw, quality) => {
                const source = item === musicItem
                    ? { ...raw, userAgent: raw.userAgent ?? (musicItem as IPlugin.IMediaSourceResult).userAgent, ...selectDownloadSourceEncryption({ original: musicItem, resolved: raw }) }
                    : raw;
                return options.prepare({ ...source, quality: source.quality ?? quality }, remaining(until));
            },
        });
    };
    const original = await resolve(musicItem, pluginManager.getByName(musicItem.platform), originalDeadline);
    if (!isActive() || original === "inactive") {
        return null;
    }
    if (original) {
        return result(original.source, musicItem, "original", original.quality);
    }
    if (musicItem.url) {
        try {
            const direct = await options.prepare({
                url: musicItem.url,
                headers: (musicItem as IPlugin.IMediaSourceResult).headers,
                userAgent: (musicItem as IPlugin.IMediaSourceResult).userAgent,
                ekey: musicItem.ekey,
                cek: musicItem.cek,
            }, remaining(originalDeadline));
            if (direct?.url && isActive()) {
                return result(direct, musicItem, "direct", direct.quality);
            }
        } catch {
            // An unusable embedded source must not prevent a remembered candidate from being tried.
        }
    }
    const currentAlternate = options.useRemembered ? getRememberedAlternate(musicItem) : null;
    const currentPlugin = currentAlternate ? pluginManager.getByMedia(currentAlternate) : null;
    if (!isActive() || !currentAlternate || !currentPlugin || !pluginManager.isPluginEnabled(currentPlugin)) {
        return null;
    }
    const candidateActive = () => isActive() && pluginManager.getByMedia(currentAlternate) === currentPlugin && pluginManager.isPluginEnabled(currentPlugin);
    const alternate = await resolve(currentAlternate, currentPlugin, deadline, candidateActive);
    return alternate && alternate !== "inactive" && isActive()
        ? result(alternate.source, currentAlternate, "remembered", alternate.quality)
        : null;
}

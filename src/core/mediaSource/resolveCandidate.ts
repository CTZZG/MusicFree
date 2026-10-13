import { getMediaUniqueKey } from "@/utils/mediaIdentity";
import {
    classifyMediaSourceFailure,
    createMediaSourceFailure,
    isProviderAccessFailure,
    mediaSourceFailureFromPluginResult,
    preferMediaSourceFailure,
    type MediaSourceFailure,
} from "@/core/pluginManager/mediaSourceFailure";

export interface ResolvedMediaSource<T extends IPlugin.IMediaSourceResult> {
    musicItem: IMusic.IMusicItem;
    source: T;
    quality: IMusic.IQualityKey;
}

/** Common candidate/quality loop; callers own deadlines, cancellation and source preparation. */
export async function resolveMediaSourceCandidate<T extends IPlugin.IMediaSourceResult>(options: {
    musicItem: IMusic.IMusicItem;
    pluginName: string;
    qualityOrder: IMusic.IQualityKey[];
    isActive: () => boolean;
    request: (quality: IMusic.IQualityKey) => Promise<IPlugin.IMediaSourceResult | null>;
    prepare: (source: IPlugin.IMediaSourceResult, quality: IMusic.IQualityKey) => Promise<T | null>;
    isTimeout: (error: unknown) => boolean;
    /** Playback stops a hung source; downloads may try another quality within their existing deadline. */
    timeoutPolicy?: "stop" | "try-next-quality";
    onFailure?: (failure: MediaSourceFailure) => void;
}): Promise<ResolvedMediaSource<T> | "inactive" | null> {
    const { musicItem, pluginName, isActive } = options;
    for (const quality of options.qualityOrder) {
        if (!isActive()) {
            return "inactive";
        }
        const context = { mediaKey: getMediaUniqueKey(musicItem), pluginName, quality };
        let candidate: IPlugin.IMediaSourceResult | null = null;
        let failure: MediaSourceFailure | null = null;
        let timedOut = false;
        try {
            candidate = await options.request(quality);
        } catch (error) {
            timedOut = options.isTimeout(error);
            failure = classifyMediaSourceFailure(error, context);
        }
        if (!isActive()) {
            return "inactive";
        }
        if (!candidate?.url) {
            failure = preferMediaSourceFailure(failure, candidate?.failure
                ? mediaSourceFailureFromPluginResult(candidate.failure, context)
                : createMediaSourceFailure("unavailable", context));
            options.onFailure?.(failure ?? createMediaSourceFailure("unavailable", context));
            if ((timedOut && options.timeoutPolicy !== "try-next-quality") || isProviderAccessFailure(failure)) {
                return null;
            }
            continue;
        }
        let source: T | null = null;
        try {
            source = await options.prepare(candidate, quality);
        } catch (error) {
            failure = classifyMediaSourceFailure(error, context);
            timedOut = options.isTimeout(error);
        }
        if (!isActive()) {
            return "inactive";
        }
        if (source?.url) {
            return { musicItem, source, quality: source.quality ?? quality };
        }
        options.onFailure?.(failure ?? (source?.failure
            ? mediaSourceFailureFromPluginResult(source.failure, context)
            : createMediaSourceFailure("source-rejected", context)));
        if (timedOut && options.timeoutPolicy !== "try-next-quality") {
            return null;
        }
    }
    return null;
}

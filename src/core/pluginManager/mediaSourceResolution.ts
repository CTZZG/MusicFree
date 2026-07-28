import {
    convertLegacyQuality,
    convertToLegacyQuality,
} from "@/utils/qualities";
import {
    classifyMediaSourceFailure,
    createMediaSourceFailureResult,
    mediaSourceFailureFromPluginResult,
    preferMediaSourceFailure,
    type MediaSourceFailure,
    type MediaSourceFailureContext,
} from "./mediaSourceFailure";

export async function callGetMediaSourceWithLegacyFallback(
    getMediaSource: IPlugin.IPluginDefine["getMediaSource"],
    musicItem: IMusic.IMusicItemBase,
    quality: IMusic.IQualityKey,
    failureContext: MediaSourceFailureContext,
    allowLegacyFallback = true,
) {
    if (!getMediaSource) {
        return null;
    }

    const normalizedQuality = convertLegacyQuality(quality);
    let result: IPlugin.IMediaSourceResult | null = null;
    let preferredFailure: MediaSourceFailure | null = null;
    try {
        result = await getMediaSource(musicItem, normalizedQuality);
    } catch (error) {
        preferredFailure = classifyMediaSourceFailure(error, failureContext);
    }
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

    const legacyQuality = convertToLegacyQuality(normalizedQuality);
    if (
        allowLegacyFallback &&
        legacyQuality &&
        legacyQuality !== normalizedQuality
    ) {
        let legacyResult: IPlugin.IMediaSourceResult | null = null;
        try {
            legacyResult = await getMediaSource(musicItem, legacyQuality);
        } catch (error) {
            preferredFailure = preferMediaSourceFailure(
                preferredFailure,
                classifyMediaSourceFailure(error, failureContext),
            );
        }
        if (legacyResult?.url) {
            return legacyResult;
        }
        if (legacyResult?.failure) {
            preferredFailure = preferMediaSourceFailure(
                preferredFailure,
                mediaSourceFailureFromPluginResult(
                    legacyResult.failure,
                    failureContext,
                ),
            );
        }
        result = legacyResult ?? result;
    }

    return preferredFailure
        ? createMediaSourceFailureResult(preferredFailure)
        : result;
}

export function normalizeMediaSourceResultWithFailure(
    mediaSourceResult: IPlugin.IMediaSourceResult,
    normalize: (
        result: IPlugin.IMediaSourceResult,
    ) => IPlugin.IMediaSourceResult,
    failureContext: MediaSourceFailureContext,
) {
    try {
        return normalize(mediaSourceResult);
    } catch (error) {
        return createMediaSourceFailureResult(
            classifyMediaSourceFailure(error, failureContext),
        );
    }
}

import TrackPlayer from "@/core/trackPlayer";
import type { MusicVideoCandidate } from "@/core/pluginManager/musicVideoSource";
import type {
    MusicVideoAction,
    MusicVideoPreflight,
} from "@/core/trackPlayer/musicVideoController";
import Config from "@/core/appConfig";
import Network from "@/utils/network";
import { getMediaUniqueKey } from "@/utils/mediaIdentity";
import i18n from "@/core/i18n";
import {
    getCurrentDialog,
    hideDialog,
    showDialog,
} from "@/components/dialogs/useDialog";
import Toast from "@/utils/toast";

let pendingConsent: AbortController | null = null;
export function cancelPendingVideoAction() {
    pendingConsent?.abort();
    pendingConsent = null;
    TrackPlayer.cancelVideoRequest();
}

function confirm(
    title: string,
    content: string,
    okText: string,
    signal: AbortSignal,
): Promise<boolean> {
    return new Promise(resolve => {
        let settled = false;
        let dialogId: number | undefined;
        const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", abort);
            resolve(value);
        };
        const abort = () => {
            if (dialogId !== undefined) hideDialog(dialogId);
            finish(false);
        };
        if (signal.aborted) {
            finish(false);
            return;
        }
        signal.addEventListener("abort", abort, { once: true });
        showDialog("SimpleDialog", {
            title,
            content,
            okText,
            onOk: () => finish(true),
            onCancel: () => finish(false),
            onDismiss: () => finish(false),
        });
        dialogId = getCurrentDialog().id;
        if (signal.aborted) abort();
    });
}

/** The controller reserves its source request BEFORE this consent callback awaits any network/UI work. */
async function requestVideoAction(
    action: (
        preflight: MusicVideoPreflight,
        restartApproved: boolean,
    ) => Promise<MusicVideoAction | undefined>,
) {
    const song = TrackPlayer.currentMusic;
    if (!song) return;
    const key = getMediaUniqueKey(song);
    const originalIntent = TrackPlayer.playbackIntentRevision;
    pendingConsent?.abort();
    const consent = new AbortController();
    pendingConsent = consent;
    const current = () =>
        !consent.signal.aborted &&
        !!TrackPlayer.currentMusic &&
        getMediaUniqueKey(TrackPlayer.currentMusic) === key;
    const preflight: MusicVideoPreflight = async parentSignal => {
        const cancel = () => consent.abort();
        parentSignal.addEventListener("abort", cancel, { once: true });
        try {
            if (parentSignal.aborted || !current()) return null;
            const network = await Network.getFreshState();
            if (!current() || parentSignal.aborted) return null;
            if (
                !network.isConnected ||
                network.isInternetReachable === false ||
                network.type === "unknown" ||
                network.type === "none"
            ) {
                Toast.warn(i18n.t("musicVideo.failed"));
                return null;
            }
            const unmetered =
                (network.type === "wifi" || network.type === "ethernet") &&
                !network.details?.isConnectionExpensive;
            if (
                !unmetered &&
                !Config.getConfig("basic.useCelluarNetworkPlay")
            ) {
                Toast.warn(i18n.t("musicVideo.mobileDisabled"));
                return null;
            }
            let approved = TrackPlayer.videoMobileApproved;
            if (!unmetered && !approved) {
                approved = await confirm(
                    i18n.t("musicVideo.mobileTitle"),
                    i18n.t("musicVideo.mobileContent"),
                    i18n.t("musicVideo.approveOnce"),
                    consent.signal,
                );
                if (!approved || !current()) return null;
            }
            return {
                mobileApproved: approved,
                claimPlayback:
                    originalIntent === TrackPlayer.playbackIntentRevision,
            };
        } finally {
            parentSignal.removeEventListener("abort", cancel);
        }
    };
    const run = async (restart = false): Promise<void> => {
        if (!current()) return;
        const result = await action(preflight, restart);
        if (!current()) return;
        if (result?.status === "restart-confirmation") {
            if (
                await confirm(
                    i18n.t("musicVideo.restartTitle"),
                    i18n.t("musicVideo.restartContent"),
                    i18n.t("musicVideo.restart"),
                    consent.signal,
                )
            )
                await run(true);
        } else if (result?.status === "error")
            Toast.warn(
                i18n.t(
                    result.error === "audio-return"
                        ? "musicVideo.returnFailed"
                        : "musicVideo.failed",
                ),
            );
    };
    try {
        await run();
    } catch {
        if (current()) Toast.warn(i18n.t("musicVideo.failed"));
    } finally {
        if (pendingConsent === consent) pendingConsent = null;
    }
}
export const watchMusicVideo = (candidate: MusicVideoCandidate) =>
    requestVideoAction(preflight =>
        TrackPlayer.watchMusicVideo(candidate, undefined, { preflight }),
    );
export const changeMusicVideoQuality = (quality: string) =>
    requestVideoAction((preflight, restartApproved) =>
        TrackPlayer.changeVideoQuality(
            quality,
            restartApproved,
            false,
            preflight,
        ),
    );
export const resumeMusicVideo = () =>
    requestVideoAction(preflight =>
        TrackPlayer.resumeMusicVideo(false, true, preflight),
    );
export async function returnToSong() {
    const result = await TrackPlayer.returnToSong();
    if (result.status === "error")
        Toast.warn(i18n.t("musicVideo.returnFailed"));
}

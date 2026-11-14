import React, { useEffect, useRef, useState } from "react";
import {
    AppState,
    BackHandler,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
    useWindowDimensions,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import type { SharedValue } from "react-native-reanimated";
import MpvVideo from "@/components/mpvVideo";
import ThemeText from "@/components/base/themeText";
import TrackPlayer, {
    useMusicState,
    useMusicVideoState,
} from "@/core/trackPlayer";
import { useI18N } from "@/core/i18n";
import { showPanel } from "@/components/panels/usePanel";
import {
    returnToSong,
    resumeMusicVideo,
} from "@/components/musicVideo/actions";
import SeekBar from "../bottom/seekBar";
import PlayControl from "../bottom/playControl";
import Icon from "@/components/base/icon";

let viewSequence = 0;
interface Props {
    fullscreen: boolean;
    onFullscreen(value: boolean): void;
    swipeProgress: SharedValue<number>;
}

/** Fullscreen changes bounds of this same native View; it never loads or seeks the player. */
export default function MusicVideoContent({
    fullscreen,
    onFullscreen,
    swipeProgress,
}: Props) {
    const state = useMusicVideoState();
    const owner = state.phase !== "audio" ? state.owner : null;
    const video = state.phase !== "audio" ? state.video : null;
    const musicState = useMusicState();
    const focused = useIsFocused();
    const window = useWindowDimensions();
    const [appActive, setAppActive] = useState(
        AppState.currentState === "active",
    );
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [frameKey, setFrameKey] = useState<string | null>(null);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [interaction, setInteraction] = useState(0);
    const [viewId] = useState(() => ++viewSequence);
    const awakeSequence = useRef(0);
    const { t } = useI18N();
    const key =
        owner?.kind === "mv"
            ? JSON.stringify([owner.mediaId, owner.loadGeneration])
            : null;
    const visible = focused && appActive;
    const hasFrame = !!key && frameKey === key;
    const error = state.phase !== "audio" ? state.error : undefined;
    const overlayText = getOverlayText();
    function getOverlayText() {
        if (state.phase === "returning") return t("musicVideo.returning");
        if (error === "audio-return") return t("musicVideo.returnFailed");
        if (error === "checkpoint-unavailable") return t("musicVideo.checkpointUnavailable");
        if (error === "network") return t("musicVideo.networkHeld");
        if (error === "source" || error === "activation") return t("musicVideo.failed");
        return t("musicVideo.loadingVideo");
    }
    const showControls = !fullscreen || controlsVisible || !hasFrame || !!error;
    useEffect(() => {
        const subscription = AppState.addEventListener("change", value =>
            setAppActive(value === "active"),
        );
        return () => subscription.remove();
    }, []);
    useEffect(() => {
        if (!focused && fullscreen) onFullscreen(false);
    }, [focused, fullscreen, onFullscreen]);
    useEffect(() => {
        setControlsVisible(true);
    }, [fullscreen, key, musicState]);
    useEffect(() => {
        if (
            !fullscreen ||
            !visible ||
            !hasFrame ||
            musicState !== "playing" ||
            !controlsVisible
        )
            return;
        const timer = setTimeout(() => setControlsVisible(false), 3000);
        return () => clearTimeout(timer);
    }, [
        fullscreen,
        visible,
        hasFrame,
        musicState,
        controlsVisible,
        interaction,
    ]);
    useEffect(() => {
        if (!fullscreen || !focused) return;
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                onFullscreen(false);
                return true;
            },
        );
        return () => subscription.remove();
    }, [fullscreen, focused, onFullscreen]);
    useEffect(() => {
        if (!visible || !key || hasFrame || !owner) return;
        const target = { ...owner };
        const timer = setTimeout(
            () => TrackPlayer.videoOutputFailed(target),
            15000,
        );
        return () => clearTimeout(timer);
    }, [visible, key, hasFrame, owner]);
    useEffect(() => {
        if (!visible || !hasFrame || musicState !== "playing") return;
        let active = true;
        // Each activation owns a tag, so a late old promise cannot release a new lease.
        const ownTag = `musicfree-mv:${viewId}:${++awakeSequence.current}`;
        activateKeepAwakeAsync(ownTag)
            .then(() => {
                if (!active) deactivateKeepAwake(ownTag);
            })
            .catch(() => undefined);
        return () => {
            active = false;
            deactivateKeepAwake(ownTag);
        };
    }, [visible, hasFrame, musicState, viewId]);
    const videoHeight = Math.max(
        0,
        Math.min((viewport.width * 9) / 16, viewport.height),
    );
    const videoWidth = Math.min(viewport.width, (videoHeight * 16) / 9);
    const returning = state.phase === "returning";
    const compact = window.height / Math.max(1, window.fontScale) < 500;
    return (
        <View
            // Keep the same Fabric stacking context when fullscreen adds zIndex;
            // reparenting a TextureView destroys its video Surface.
            collapsable={false}
            style={[styles.root, fullscreen ? styles.fullscreen : null]}
            testID="music-video-content">
            <View
                style={styles.stage}
                onLayout={event => {
                    const { width, height } = event.nativeEvent.layout;
                    setViewport(previous => {
                        // A transient empty layout during rotation must not unmount
                        // the TextureView and reset the paused video output.
                        if (width <= 0 || height <= 0) return previous;
                        return Math.abs(previous.width - width) < 0.5 &&
                            Math.abs(previous.height - height) < 0.5
                            ? previous
                            : { width, height };
                    });
                }}>
                {owner?.kind === "mv" && videoWidth > 0 && videoHeight > 0 ? (
                    <View
                        style={[
                            styles.video,
                            fullscreen
                                ? styles.fullscreenVideo
                                : styles.inlineVideo,
                            { width: videoWidth, height: videoHeight },
                        ]}>
                        <MpvVideo
                            testID="music-video-surface"
                            accessibilityLabel={t("musicVideo.surface")}
                            mediaId={owner.mediaId}
                            loadGeneration={owner.loadGeneration}
                            outputVisible={visible}
                            style={styles.nativeVideo}
                            onVideoFrame={event => {
                                const current =
                                    TrackPlayer.playerAdapter.getRenditionOwner?.();
                                if (
                                    key &&
                                    event.nativeEvent.mediaId ===
                                        owner.mediaId &&
                                    event.nativeEvent.loadGeneration ===
                                        owner.loadGeneration &&
                                    current?.kind === "mv" &&
                                    current.mediaId === owner.mediaId &&
                                    current.loadGeneration ===
                                        owner.loadGeneration
                                )
                                    setFrameKey(key);
                            }}
                        />
                    </View>
                ) : null}
                {!hasFrame || returning ? (
                    <View pointerEvents="none" style={styles.waiting}>
                        <ThemeText color="white" style={styles.message}>
                            {overlayText}
                        </ThemeText>
                    </View>
                ) : null}
                {fullscreen ? (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("musicVideo.controls")}
                        style={styles.tapSurface}
                        onPress={() => setControlsVisible(value => !value)}
                    />
                ) : null}
            </View>
            {!fullscreen && !compact && video ? (
                <View style={styles.caption}>
                    <ThemeText
                        color="white"
                        style={styles.title}
                        numberOfLines={2}>
                        {video.title}
                    </ThemeText>
                    <ThemeText
                        color="white"
                        opacity={0.65}
                        style={styles.source}>
                        {video.providerName}
                        {video.qualityId
                            ? ` · ${
                                video.qualities?.find(
                                    value => value.id === video.qualityId,
                                )?.label ?? video.qualityId
                            }`
                            : ""}
                    </ThemeText>
                </View>
            ) : null}
            {showControls ? (
                <View
                    style={[
                        styles.toolbar,
                        fullscreen ? styles.overlayToolbar : null,
                    ]}
                    onTouchStart={() => setInteraction(value => value + 1)}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t(
                            fullscreen
                                ? "musicVideo.exitFullscreen"
                                : "musicVideo.fullscreen",
                        )}
                        style={styles.button}
                        onPress={() => onFullscreen(!fullscreen)}>
                        {compact ? (
                            <Icon
                                name="arrows-pointing-out"
                                color="white"
                                size={24}
                            />
                        ) : (
                            <ThemeText color="white">
                                {t(
                                    fullscreen
                                        ? "musicVideo.exitFullscreen"
                                        : "musicVideo.fullscreen",
                                )}
                            </ThemeText>
                        )}
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("musicVideo.options")}
                        style={styles.button}
                        onPress={() => showPanel("MusicVideo")}>
                        {compact ? (
                            <Icon
                                name="ellipsis-vertical"
                                color="white"
                                size={24}
                            />
                        ) : (
                            <ThemeText color="white">
                                {t("musicVideo.options")}
                            </ThemeText>
                        )}
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("musicVideo.returnToSong")}
                        style={styles.button}
                        disabled={returning}
                        onPress={() => {
                            returnToSong();
                        }}>
                        {compact ? (
                            <Icon name="musical-note" color="white" size={24} />
                        ) : (
                            <ThemeText color="white">
                                {t("musicVideo.returnToSong")}
                            </ThemeText>
                        )}
                    </Pressable>
                    {error === "network" ? (
                        <Pressable
                            accessibilityRole="button"
                            style={styles.button}
                            onPress={() => {
                                resumeMusicVideo();
                            }}>
                            <ThemeText color="white">
                                {t("musicVideo.resumeOnMobile")}
                            </ThemeText>
                        </Pressable>
                    ) : null}
                </View>
            ) : null}
            {fullscreen && showControls ? (
                <ScrollView
                    style={[
                        styles.controls,
                        { maxHeight: window.height * 0.5 },
                    ]}
                    onTouchStart={() => setInteraction(value => value + 1)}>
                    <SeekBar />
                    <PlayControl swipeProgress={swipeProgress} />
                </ScrollView>
            ) : null}
        </View>
    );
}
const styles = StyleSheet.create({
    nativeVideo: { width: "100%", height: "100%" },
    video: { backgroundColor: "black", overflow: "hidden" },
    inlineVideo: { borderRadius: 12 },
    fullscreenVideo: { borderRadius: 0 },
    root: { flex: 1, minHeight: 0, width: "100%", paddingHorizontal: 12 },
    fullscreen: {
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 5,
        paddingHorizontal: 0,
        backgroundColor: "black",
    },
    stage: {
        flex: 1,
        minHeight: 0,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
    },
    waiting: {
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 8,
        paddingVertical: 0,
    },
    tapSurface: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
    message: { textAlign: "center" },
    caption: { paddingHorizontal: 12, paddingTop: 8 },
    title: { fontSize: 18 },
    source: { fontSize: 14, marginTop: 6 },
    toolbar: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-evenly",
        alignItems: "center",
    },
    overlayToolbar: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: "#000b",
    },
    button: {
        minWidth: 48,
        minHeight: 48,
        paddingHorizontal: 10,
        paddingVertical: 10,
        justifyContent: "center",
        alignItems: "center",
        flexShrink: 1,
    },
    controls: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "#000b",
        paddingBottom: 4,
    },
});

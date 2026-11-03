import React, { useEffect, useState } from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    View,
    useWindowDimensions,
} from "react-native";
import TrackPlayer, {
    useCurrentMusic,
    useMusicVideoState,
} from "@/core/trackPlayer";
import type { MusicVideoCandidate } from "@/core/pluginManager/musicVideoSource";
import { useI18N } from "@/core/i18n";
import { getMediaUniqueKey } from "@/utils/mediaIdentity";
import timeformat from "@/utils/timeformat";
import ThemeText from "@/components/base/themeText";
import useColors from "@/hooks/useColors";
import {
    changeMusicVideoQuality,
    returnToSong,
    resumeMusicVideo,
    watchMusicVideo,
} from "@/components/musicVideo/actions";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { hidePanel } from "../usePanel";
import { ROUTE_PATH, useNavigate } from "@/core/router";

export default function MusicVideo() {
    const song = useCurrentMusic();
    const state = useMusicVideoState();
    const { t } = useI18N();
    const navigate = useNavigate();
    const colors = useColors();
    const { height } = useWindowDimensions();
    const key = song ? getMediaUniqueKey(song) : null;
    const [items, setItems] = useState<MusicVideoCandidate[]>([]);
    const [status, setStatus] = useState<"loading" | "ready" | "error">(
        "loading",
    );
    const [revision, setRevision] = useState(0);
    useEffect(() => {
        let active = true;
        const request = new AbortController();
        setItems([]);
        setStatus("loading");
        TrackPlayer.findMusicVideos(request.signal)
            .then(data => {
                if (active) {
                    setItems(data);
                    setStatus("ready");
                }
            })
            .catch(() => {
                if (active) setStatus("error");
            });
        return () => {
            active = false;
            request.abort();
        };
    }, [key, revision]);
    const video =
        state.phase !== "audio" && state.songKey === key ? state : null;
    const act = (action: () => unknown) => {
        hidePanel();
        action();
    };
    return (
        <PanelBase
            height={Math.min(height * 0.82, 620)}
            renderBody={() => (
                <View style={[styles.body, { maxHeight: height * 0.82 }]}>
                    <PanelHeader title={t("musicVideo.title")} />
                    <ScrollView
                        style={styles.scroll}
                        contentContainerStyle={styles.content}>
                        {video ? (
                            <>
                                <ThemeText style={styles.heading}>
                                    {video.video.title}
                                </ThemeText>
                                <ThemeText style={styles.detail}>
                                    {video.video.providerName}
                                </ThemeText>
                                {video.error === "network" ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        style={styles.action}
                                        onPress={() => act(resumeMusicVideo)}>
                                        <ThemeText
                                            style={{ color: colors.primary }}>
                                            {t("musicVideo.approveOnce")}
                                        </ThemeText>
                                    </Pressable>
                                ) : null}
                                {video.video.qualities?.length ? (
                                    <>
                                        <ThemeText style={styles.heading}>
                                            {t("musicVideo.quality")}
                                        </ThemeText>
                                        {video.video.qualities.map(quality => (
                                            <Pressable
                                                key={quality.id}
                                                accessibilityRole="button"
                                                disabled={
                                                    video.phase === "returning"
                                                }
                                                accessibilityState={{
                                                    selected:
                                                        quality.id ===
                                                        video.video.qualityId,
                                                    disabled:
                                                        video.phase ===
                                                        "returning",
                                                }}
                                                style={styles.action}
                                                onPress={() =>
                                                    act(() =>
                                                        changeMusicVideoQuality(
                                                            quality.id,
                                                        ),
                                                    )
                                                }>
                                                <ThemeText
                                                    style={
                                                        quality.id ===
                                                        video.video.qualityId
                                                            ? {
                                                                color: colors.primary,
                                                            }
                                                            : undefined
                                                    }>
                                                    {quality.label}
                                                </ThemeText>
                                            </Pressable>
                                        ))}
                                    </>
                                ) : null}
                                {video.canReturn ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        style={styles.action}
                                        disabled={video.phase === "returning"}
                                        onPress={() => act(returnToSong)}>
                                        <ThemeText
                                            style={{ color: colors.primary }}>
                                            {t("musicVideo.returnToSong")}
                                        </ThemeText>
                                    </Pressable>
                                ) : null}
                                {video.phase === "resolving" ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        style={styles.action}
                                        onPress={() =>
                                            act(() =>
                                                TrackPlayer.cancelVideoRequest(),
                                            )
                                        }>
                                        <ThemeText>
                                            {t("common.cancel")}
                                        </ThemeText>
                                    </Pressable>
                                ) : null}
                                <ThemeText style={styles.notice}>
                                    {t("musicVideo.backgroundNotice")}
                                </ThemeText>
                            </>
                        ) : null}
                        <ThemeText style={styles.heading}>
                            {t("musicVideo.browse")}
                        </ThemeText>
                        {status === "loading" ? (
                            <ThemeText style={styles.detail}>
                                {t("common.loading")}
                            </ThemeText>
                        ) : null}
                        {status === "error" ? (
                            <Pressable
                                accessibilityRole="button"
                                style={styles.action}
                                onPress={() => setRevision(value => value + 1)}>
                                <ThemeText>{t("musicVideo.retry")}</ThemeText>
                            </Pressable>
                        ) : null}
                        {status === "ready" && !items.length ? (
                            <ThemeText style={styles.detail}>
                                {t("musicVideo.empty")}
                            </ThemeText>
                        ) : null}
                        {items.map(item => (
                            <Pressable
                                key={`${item.providerKey}:${item.id}`}
                                accessibilityRole="button"
                                disabled={video?.phase === "returning"}
                                style={styles.item}
                                onPress={() =>
                                    act(() => {
                                        navigate(ROUTE_PATH.MUSIC_DETAIL);
                                        return watchMusicVideo(item);
                                    })
                                }>
                                <ThemeText style={styles.heading}>
                                    {item.title}
                                </ThemeText>
                                <ThemeText style={styles.detail}>
                                    {[
                                        item.artist,
                                        item.providerName,
                                        item.durationSeconds
                                            ? timeformat(item.durationSeconds)
                                            : null,
                                    ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </ThemeText>
                                <ThemeText style={{ color: colors.primary }}>
                                    {t("musicVideo.watch")}
                                </ThemeText>
                            </Pressable>
                        ))}
                    </ScrollView>
                </View>
            )}
        />
    );
}
const styles = StyleSheet.create({
    body: { flexShrink: 1, minHeight: 0 },
    scroll: { flexShrink: 1 },
    content: { paddingHorizontal: 20, paddingBottom: 24 },
    heading: { fontSize: 18, marginVertical: 8, flexShrink: 1 },
    detail: { fontSize: 14, opacity: 0.7, marginBottom: 8 },
    action: { minHeight: 48, paddingVertical: 12, justifyContent: "center" },
    item: {
        minHeight: 72,
        paddingVertical: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: "#8885",
    },
    notice: { fontSize: 14, opacity: 0.7, marginVertical: 12 },
});

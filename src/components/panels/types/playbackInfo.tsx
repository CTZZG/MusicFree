import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import TrackPlayer, {
    useCurrentMusic,
    useMusicQuality,
    useAlternateSourceInUse,
} from "@/core/trackPlayer";
import type { PlayerAudioInfo } from "@/core/playerAdapter";
import { useI18N } from "@/core/i18n";
import { getQualityText } from "@/utils/qualities";
import { useAppConfig } from "@/core/appConfig";
import { getMediaUniqueKey } from "@/utils/mediaUtils";
import { withTimeout } from "@/utils/promiseTimeout";
import { vh } from "@/utils/rpx";
import ThemeText from "@/components/base/themeText";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";

function positive(value: unknown, max: number) {
    return typeof value === "number" &&
        Number.isFinite(value) &&
        value > 0 &&
        value <= max
        ? value
        : null;
}

/** Format only known numeric/codec fields; never render an opaque native object or a URL. */
export function audioInfoText(info: PlayerAudioInfo | null, unknown: string) {
    const codec =
        typeof info?.codec === "string" &&
        /^[A-Za-z0-9_.+ -]{1,64}$/.test(info.codec)
            ? info.codec
            : unknown;
    const rate = positive(info?.sampleRate, 3_840_000);
    const channels = positive(info?.channelCount, 64);
    const bitrate = positive(info?.bitrate, 1_000_000_000);
    return {
        codec,
        sampleRate:
            rate && Number.isInteger(rate) ? `${rate / 1000} kHz` : unknown,
        channelCount:
            channels && Number.isInteger(channels) ? String(channels) : unknown,
        bitrate: bitrate
            ? `${Number((bitrate / 1000).toPrecision(4))} kb/s`
            : unknown,
    };
}

/** Mounted on demand. Existing activation/state events refresh a snapshot; no timer/polling or commands. */
export default function PlaybackInfo() {
    const music = useCurrentMusic();
    const quality = useMusicQuality();
    const alternate = useAlternateSourceInUse();
    const qualityTranslations = useAppConfig("basic.qualityTranslations");
    const i18n = useI18N();
    const { t } = i18n;
    const key = music ? getMediaUniqueKey(music) : null;
    const [result, setResult] = useState<{
        key: string;
        info: PlayerAudioInfo;
    } | null>(null);
    const [loading, setLoading] = useState(false);
    const [revision, setRevision] = useState(0);
    const ready = TrackPlayer.isReady;
    useEffect(() => {
        let active = true;
        let sequence = 0;
        if (!key || !ready) {
            setResult(null);
            setLoading(false);
            return;
        }
        const adapter = TrackPlayer.playerAdapter;
        function refresh() {
            const request = ++sequence;
            setResult(null);
            if (!adapter?.getAudioInfo) {
                setLoading(false);
                return;
            }
            setLoading(true);
            const current = () =>
                active &&
                sequence === request &&
                TrackPlayer.currentMusic &&
                getMediaUniqueKey(TrackPlayer.currentMusic) === key;
            withTimeout(
                Promise.resolve().then(() => adapter.getAudioInfo!()),
                2000,
            )
                .then(info => {
                    if (current()) setResult(info ? { key: key!, info } : null);
                })
                .catch(() => {
                    if (current()) setResult(null);
                })
                .finally(() => {
                    if (current()) setLoading(false);
                });
        }
        const track = adapter?.addEventListener("trackChanged", refresh);
        const state = adapter?.addEventListener(
            "playbackStateChanged",
            refresh,
        );
        refresh();
        return () => {
            active = false;
            sequence++;
            track?.remove();
            state?.remove();
        };
    }, [key, quality, alternate, revision, ready]);
    const info = result?.key === key ? result.info : null;
    const unknown = t("playbackInfo.unknown");
    const values = audioInfoText(info, unknown);
    const row = (label: string, value: string) => (
        <View
            key={label}
            style={styles.row}
            accessible
            accessibilityLabel={`${label}: ${value}`}>
            <ThemeText fontColor="textSecondary">{label}</ThemeText>
            <ThemeText selectable>{value}</ThemeText>
        </View>
    );
    const qualityText = quality
        ? getQualityText(i18n.getLanguage().languageData, qualityTranslations)[
            quality
        ] ?? quality
        : unknown;
    return (
        <PanelBase
            height={vh(75)}
            renderBody={() => (
                <>
                    <PanelHeader
                        title={t("playbackInfo.title")}
                        hideButtons
                        allowTitleWrap
                    />
                    <ScrollView
                        style={styles.scroll}
                        contentContainerStyle={styles.content}>
                        <ThemeText fontWeight="semibold">
                            {music?.title || t("playbackInfo.noTrack")}
                        </ThemeText>
                        <ThemeText fontColor="textSecondary">
                            {t("playbackInfo.note")}
                        </ThemeText>
                        {loading ? (
                            <ThemeText accessibilityLiveRegion="polite">
                                {t("playbackInfo.loading")}
                            </ThemeText>
                        ) : null}
                        {row(
                            t("playbackInfo.originalSource"),
                            music?.platform || unknown,
                        )}
                        {row(
                            t("playbackInfo.playbackSource"),
                            info
                                ? alternate || music?.platform || unknown
                                : unknown,
                        )}
                        {row(
                            t("playbackInfo.qualityLabel"),
                            String(qualityText),
                        )}
                        {row(t("playbackInfo.codec"), values.codec)}
                        {row(t("playbackInfo.sampleRate"), values.sampleRate)}
                        {row(
                            t("playbackInfo.channelCount"),
                            values.channelCount,
                        )}
                        {row(t("playbackInfo.bitrate"), values.bitrate)}
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t("playbackInfo.refresh")}
                            disabled={loading}
                            accessibilityState={{ disabled: loading }}
                            style={[
                                styles.refresh,
                                loading ? styles.dimmed : null,
                            ]}
                            onPress={() => setRevision(value => value + 1)}>
                            <ThemeText fontColor="primary">
                                {t("playbackInfo.refresh")}
                            </ThemeText>
                        </Pressable>
                    </ScrollView>
                </>
            )}
        />
    );
}
const styles = StyleSheet.create({
    scroll: { flex: 1 },
    content: { padding: 20, paddingBottom: 48, gap: 12 },
    row: { minHeight: 48, justifyContent: "center", gap: 4 },
    refresh: { minHeight: 48, justifyContent: "center", paddingVertical: 12 },
    dimmed: { opacity: 0.5 },
});

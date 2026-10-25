import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    FlatList,
    Pressable,
    Share,
    StyleSheet,
    Switch,
    View,
    useWindowDimensions,
} from "react-native";
import Svg from "react-native-svg";
import ImageColors from "react-native-image-colors";
import ThemeText from "@/components/base/themeText";
import lyricManager from "@/core/lyricManager";
import TrackPlayer from "@/core/trackPlayer";
import { formatMusicShareMessage } from "@/core/musicShare";
import { useI18N } from "@/core/i18n";
import useColors from "@/hooks/useColors";
import useResolvedMusicArtwork from "@/hooks/useResolvedMusicArtwork";
import { isSameMediaItem } from "@/utils/mediaUtils";
import NativeUtils from "@/native/utils";
import Toast from "@/utils/toast";
import { vh } from "@/utils/rpx";
import {
    createArtworkColorCacheKey,
    resolveImmersiveAmbientColor,
} from "@/pages/musicDetail/immersiveBackgroundPalette";
import ShareCard from "@/components/musicShare/shareCard";
import {
    CARD_WIDTH,
    MAX_SHARE_LINES,
    getShareCardLayout,
    toggleShareLine,
    type ShareLyricLine,
} from "@/components/musicShare/cardLayout";
import { captureShareCard, shareCardPng } from "@/components/musicShare/shareImage";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";

interface Props {
    musicItem: IMusic.IMusicItem;
}

/** Freeze a matching lyric snapshot so a subsequent track change cannot relabel the card. */
export function shareLyricSnapshot(musicItem: IMusic.IMusicItem): ShareLyricLine[] {
    if (
        !isSameMediaItem(musicItem, TrackPlayer.currentMusic) ||
        lyricManager.lyricState.loading ||
        !lyricManager.getLyricDiagnosticSnapshot().parserMatchesCurrentMusic
    )
        return [];
    return lyricManager.lyricState.lyrics
        .map((line, index) => ({
            index,
            text: line.lrc?.trim() ?? "",
            translation: line.translation?.trim(),
        }))
        .filter(line => line.text.length > 0);
}

export default function MusicShare({ musicItem }: Props) {
    const { t } = useI18N();
    const colors = useColors();
    const { width } = useWindowDimensions();
    const artwork = useResolvedMusicArtwork(musicItem);
    const [lines] = useState(() => shareLyricSnapshot(musicItem));
    const [selected, setSelected] = useState<number[]>([]);
    const [translation, setTranslation] = useState(false);
    const [color, setColor] = useState("#31516a");
    const [cover, setCover] = useState({ key: artwork, ready: !artwork, omit: false });
    const coverReady = !artwork || (cover.key === artwork && cover.ready);
    const omitCover = cover.key === artwork && cover.omit;
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const svg = useRef<Svg>(null);
    const activeArtwork = useRef(artwork);
    const loadedArtwork = useRef<string | undefined>(undefined);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        activeArtwork.current = artwork;
        loadedArtwork.current = undefined;
        setCover({ key: artwork, ready: !artwork, omit: false });
        if (!artwork) return;
        let active = true;
        const timeout = setTimeout(() => {
            if (active && loadedArtwork.current !== artwork) {
                setCover({ key: artwork, ready: true, omit: true });
            }
        }, 4000);
        ImageColors.getColors(artwork, {
            cache: true,
            key: createArtworkColorCacheKey(artwork),
            fallback: "#31516a",
        })
            .then(value => {
                if (active) setColor(resolveImmersiveAmbientColor(value));
            })
            .catch(() => undefined);
        return () => {
            active = false;
            clearTimeout(timeout);
        };
    }, [artwork]);
    const picked = useMemo(
        () => lines.filter(line => selected.includes(line.index)),
        [lines, selected],
    );
    const title = String(musicItem.title ?? "MusicFree");
    const artist = String(musicItem.artist ?? "");
    const layout = getShareCardLayout(title, artist, picked, translation);
    async function run(action: "text" | "save" | "image") {
        if (busyRef.current || (action !== "text" && !coverReady)) return;
        busyRef.current = true;
        setBusy(true);
        try {
            if (action === "text") {
                const message = await formatMusicShareMessage(musicItem);
                if (mounted.current) await Share.share({ message });
            } else {
                const node = svg.current;
                if (!node) throw new Error("Preview unavailable");
                const png = await captureShareCard(done =>
                    node.toDataURL(done, { width: CARD_WIDTH, height: layout.height }),
                );
                if (!mounted.current) return;
                if (action === "save") {
                    await NativeUtils.saveShareImage(png);
                    if (mounted.current) Toast.success(t("shareCard.saved"));
                } else await shareCardPng(png);
            }
        } catch {
            if (mounted.current) Toast.warn(t("shareCard.failed"));
        } finally {
            busyRef.current = false;
            if (mounted.current) setBusy(false);
        }
    }
    const actionButton = (label: string, action: "text" | "save" | "image") => (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{
                disabled: busy || (action !== "text" && !coverReady),
                busy,
            }}
            disabled={busy || (action !== "text" && !coverReady)}
            onPress={() => run(action)}
            style={[
                styles.action,
                { backgroundColor: colors.placeholder },
                busy ? styles.dimmed : null,
            ]}>
            <ThemeText fontWeight="semibold">{label}</ThemeText>
        </Pressable>
    );
    return (
        <PanelBase
            height={vh(88)}
            renderBody={() => (
                <>
                    <PanelHeader title={t("shareCard.title")} hideButtons allowTitleWrap />
                    <FlatList
                        style={styles.list}
                        data={lines}
                        extraData={selected}
                        keyExtractor={line => String(line.index)}
                        contentContainerStyle={styles.content}
                        ListHeaderComponent={
                            <>
                                <View
                                    style={styles.preview}
                                    accessibilityLabel={t("shareCard.preview")}>
                                    <ShareCard
                                        ref={svg}
                                        title={title}
                                        artist={artist}
                                        lines={picked}
                                        translation={translation}
                                        color={color}
                                        artwork={omitCover ? undefined : artwork}
                                        width={Math.min(width - 56, 300)}
                                        onArtworkLoad={() => {
                                            if (activeArtwork.current === artwork) {
                                                loadedArtwork.current = artwork;
                                                setCover(value =>
                                                    value.key === artwork && !value.omit
                                                        ? { ...value, ready: true }
                                                        : value,
                                                );
                                            }
                                        }}
                                    />
                                </View>
                                {!coverReady ? (
                                    <ThemeText fontColor="textSecondary">
                                        {t("shareCard.preparing")}
                                    </ThemeText>
                                ) : null}
                                <View style={styles.actions}>
                                    {actionButton(t("shareCard.link"), "text")}
                                    {actionButton(t("shareCard.save"), "save")}
                                    {actionButton(t("shareCard.image"), "image")}
                                </View>
                                <ThemeText fontColor="textSecondary">
                                    {lines.length
                                        ? t("shareCard.select")
                                        : t("shareCard.noLyrics")}
                                </ThemeText>
                                {lines.length ? (
                                    <ThemeText>
                                        {t("shareCard.selected", {
                                            count: selected.length,
                                        })}
                                    </ThemeText>
                                ) : null}
                                {lines.some(line => line.translation) ? (
                                    <View style={styles.row}>
                                        <ThemeText style={styles.switchLabel}>
                                            {t("shareCard.translation")}
                                        </ThemeText>
                                        <Switch
                                            value={translation}
                                            disabled={busy}
                                            accessibilityLabel={t(
                                                "shareCard.translation",
                                            )}
                                            onValueChange={setTranslation}
                                        />
                                    </View>
                                ) : null}
                            </>
                        }
                        renderItem={({ item }) => (
                            <Pressable
                                accessibilityRole="checkbox"
                                accessibilityLabel={t("shareCard.line", {
                                    text: item.text,
                                })}
                                accessibilityState={{
                                    checked: selected.includes(item.index),
                                    disabled:
                                        busy ||
                                        (selected.length === MAX_SHARE_LINES &&
                                            !selected.includes(item.index)),
                                }}
                                disabled={
                                    busy ||
                                    (selected.length === MAX_SHARE_LINES &&
                                        !selected.includes(item.index))
                                }
                                onPress={() =>
                                    setSelected(value =>
                                        toggleShareLine(value, item.index),
                                    )
                                }
                                style={[
                                    styles.lyric,
                                    selected.includes(item.index)
                                        ? { backgroundColor: colors.placeholder }
                                        : null,
                                    selected.length === MAX_SHARE_LINES &&
                                    !selected.includes(item.index)
                                        ? styles.dimmed
                                        : null,
                                ]}>
                                <ThemeText>
                                    {selected.includes(item.index) ? "✓  " : "○  "}
                                    {item.text}
                                </ThemeText>
                            </Pressable>
                        )}
                    />
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    list: { flex: 1 },
    switchLabel: { flex: 1, marginRight: 12 },
    content: { padding: 20, paddingBottom: 48 },
    preview: { alignItems: "center", marginBottom: 16 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 16 },
    action: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12 },
    dimmed: { opacity: 0.5 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginVertical: 12,
    },
    lyric: { padding: 14, borderRadius: 10, marginVertical: 3 },
});

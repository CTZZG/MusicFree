import FastImage from "@/components/base/fastImage";
import Icon from "@/components/base/icon.tsx";
import ThemeText from "@/components/base/themeText";
import { showPanel } from "@/components/panels/usePanel";
import { ImgAsset } from "@/constants/assetsConst";
import { useI18N } from "@/core/i18n";
import pluginManager from "@/core/pluginManager";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import TrackPlayer, {
    useMusicQuality,
    useMusicState,
    useProgress,
} from "@/core/trackPlayer";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import { musicIsPaused } from "@/utils/trackUtils";
import {
    getAvailableQualities,
    getQualityAbbr,
    TRY_QUALITYS_LIST,
} from "@/utils/qualities";
import Color from "color";
import React, { useMemo } from "react";
import {
    DimensionValue,
    Pressable,
    StyleSheet,
    View,
} from "react-native";
import ClassicSection from "./classicSection";

function formatTime(value?: number) {
    const seconds = Math.max(0, Math.floor(value ?? 0));
    const minute = Math.floor(seconds / 60);
    const second = seconds % 60;
    return `${minute}:${String(second).padStart(2, "0")}`;
}

function getProgressPercent(
    position?: number,
    duration?: number,
): DimensionValue {
    if (!position || !duration || duration <= 0) {
        return "0%";
    }
    return `${Math.min(
        100,
        Math.max(0, (position / duration) * 100),
    )}%` as DimensionValue;
}

function getMusicSubtitle(musicItem?: IMusic.IMusicItem | null) {
    if (!musicItem) {
        return "";
    }
    return [musicItem.artist, musicItem.album]
        .map(item =>
            item === undefined || item === null ? "" : String(item).trim(),
        )
        .filter(Boolean)
        .join(" · ");
}

function getBestQualityBadge(musicItem: IMusic.IMusicItem) {
    const plugin = pluginManager.getByMedia(musicItem);
    const availableQualities = getAvailableQualities(musicItem, {
        supportedQualities: plugin?.instance?.supportedQualities,
    });
    const bestQuality =
        TRY_QUALITYS_LIST.find(quality =>
            availableQualities.includes(quality),
        ) ?? availableQualities[0];

    return bestQuality ? getQualityAbbr(bestQuality) : "";
}

interface IClassicContinueHeroProps {
    currentMusic: IMusic.IMusicItem | null;
    featuredMusic: IMusic.IMusicItem | null;
}

export default function ClassicContinueHero(
    props: IClassicContinueHeroProps,
) {
    const { currentMusic, featuredMusic } = props;
    const musicState = useMusicState();
    const currentQuality = useMusicQuality();
    const { position, duration } = useProgress();
    const colors = useColors();
    const { t } = useI18N();
    const navigate = useNavigate();

    const isCurrent =
        !!currentMusic &&
        !!featuredMusic &&
        currentMusic.platform === featuredMusic.platform &&
        currentMusic.id === featuredMusic.id;
    const progressDuration = isCurrent
        ? duration || featuredMusic?.duration
        : featuredMusic?.duration;
    const progressPosition = isCurrent ? position : 0;
    const qualityBadge = useMemo(() => {
        if (!featuredMusic) {
            return "";
        }
        return isCurrent
            ? getQualityAbbr(currentQuality)
            : getBestQualityBadge(featuredMusic);
    }, [currentQuality, featuredMusic, isCurrent]);
    const subtitle = useMemo(
        () => getMusicSubtitle(featuredMusic),
        [featuredMusic],
    );

    if (!featuredMusic) {
        return (
            <ClassicSection title={t("home.continueListening")}>
                <View
                    style={[
                        styles.emptyCard,
                        {
                            backgroundColor: colors.card,
                            borderColor: Color(colors.text)
                                .alpha(0.06)
                                .toString(),
                        },
                    ]}>
                    <QuickPill
                        icon="inbox-arrow-down"
                        title={t("home.importPlaylist.a11y")}
                        onPress={() => showPanel("ImportMusicSheet")}
                    />
                    <QuickPill
                        icon="folder-music-outline"
                        title={t("home.scanLocal")}
                        onPress={() => navigate(ROUTE_PATH.LOCAL)}
                    />
                </View>
            </ClassicSection>
        );
    }

    return (
        <ClassicSection title={t("home.continueListening")}>
            <Pressable
                style={[
                    styles.heroCard,
                    {
                        backgroundColor: colors.card,
                        borderColor: Color(colors.text).alpha(0.07).toString(),
                    },
                ]}
                onPress={() => {
                    if (isCurrent) {
                        navigate(ROUTE_PATH.MUSIC_DETAIL);
                    } else {
                        TrackPlayer.play(featuredMusic);
                    }
                }}>
                <View
                    style={[
                        styles.heroAccent,
                        {
                            backgroundColor: Color(colors.primary)
                                .alpha(0.08)
                                .toString(),
                        },
                    ]}
                />
                <FastImage
                    source={featuredMusic.artwork}
                    placeholderSource={ImgAsset.albumDefault}
                    style={styles.cover}
                />
                <View style={styles.content}>
                    <View style={styles.titleRow}>
                        <ThemeText
                            numberOfLines={2}
                            fontSize="title"
                            fontWeight="bold"
                            style={styles.title}>
                            {featuredMusic.title}
                        </ThemeText>
                    </View>
                    <View style={styles.metaRow}>
                        {featuredMusic.platform ? (
                            <View
                                style={[
                                    styles.sourceBadge,
                                    {
                                        backgroundColor: Color(colors.primary)
                                            .alpha(0.14)
                                            .toString(),
                                    },
                                ]}>
                                <ThemeText
                                    numberOfLines={1}
                                    fontSize="tag"
                                    color={colors.primary}>
                                    {featuredMusic.platform}
                                </ThemeText>
                            </View>
                        ) : null}
                        {qualityBadge ? (
                            <View
                                style={[
                                    styles.qualityBadge,
                                    {
                                        backgroundColor: Color(colors.primary)
                                            .alpha(0.08)
                                            .toString(),
                                        borderColor: Color(colors.primary)
                                            .alpha(0.3)
                                            .toString(),
                                    },
                                ]}>
                                <ThemeText
                                    numberOfLines={1}
                                    fontSize="tag"
                                    color={colors.primary}>
                                    {qualityBadge}
                                </ThemeText>
                            </View>
                        ) : null}
                        {subtitle ? (
                            <ThemeText
                                numberOfLines={1}
                                fontSize="description"
                                fontColor="textSecondary"
                                style={styles.metaText}>
                                {subtitle}
                            </ThemeText>
                        ) : null}
                    </View>
                    <View style={styles.progressRow}>
                        <ThemeText fontSize="tag" fontColor="textSecondary">
                            {formatTime(progressPosition)}
                        </ThemeText>
                        <View
                            style={[
                                styles.progressTrack,
                                {
                                    backgroundColor: Color(colors.text)
                                        .alpha(0.1)
                                        .toString(),
                                },
                            ]}>
                            <View
                                style={[
                                    styles.progressFill,
                                    {
                                        backgroundColor: colors.primary,
                                        width: getProgressPercent(
                                            progressPosition,
                                            progressDuration,
                                        ),
                                    },
                                ]}
                            />
                        </View>
                        <ThemeText fontSize="tag" fontColor="textSecondary">
                            {formatTime(progressDuration)}
                        </ThemeText>
                    </View>
                </View>
                <Pressable
                    style={[
                        styles.playButton,
                        {
                            backgroundColor: Color(colors.primary)
                                .alpha(0.18)
                                .toString(),
                        },
                    ]}
                    onPress={() => {
                        if (isCurrent && !musicIsPaused(musicState)) {
                            TrackPlayer.pause();
                        } else {
                            TrackPlayer.play(featuredMusic);
                        }
                    }}>
                    <Icon
                        name={
                            isCurrent && !musicIsPaused(musicState)
                                ? "pause"
                                : "play"
                        }
                        size={rpx(38)}
                        color={colors.primary}
                    />
                </Pressable>
            </Pressable>
        </ClassicSection>
    );
}

function QuickPill(props: {
    icon: "folder-music-outline" | "inbox-arrow-down";
    title: string;
    onPress: () => void;
}) {
    const { icon, title, onPress } = props;
    const colors = useColors();

    return (
        <Pressable
            style={[
                styles.quickPill,
                { backgroundColor: Color(colors.text).alpha(0.07).toString() },
            ]}
            onPress={onPress}>
            <Icon name={icon} size={rpx(30)} color={colors.text} />
            <ThemeText
                numberOfLines={1}
                fontSize="description"
                fontWeight="semibold"
                style={styles.quickPillText}>
                {title}
            </ThemeText>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    heroCard: {
        position: "relative",
        minHeight: rpx(190),
        marginHorizontal: rpx(24),
        padding: rpx(18),
        borderRadius: rpx(18),
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "hidden",
        flexDirection: "row",
        alignItems: "center",
    },
    heroAccent: {
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: rpx(7),
    },
    cover: {
        width: rpx(138),
        height: rpx(138),
        borderRadius: rpx(16),
    },
    content: {
        flex: 1,
        minWidth: 0,
        marginLeft: rpx(18),
    },
    titleRow: {
        minWidth: 0,
    },
    title: {
        minWidth: 0,
        lineHeight: rpx(40),
    },
    metaRow: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: rpx(12),
        minWidth: 0,
        overflow: "hidden",
    },
    sourceBadge: {
        maxWidth: rpx(124),
        minHeight: rpx(32),
        paddingHorizontal: rpx(10),
        borderRadius: rpx(16),
        alignItems: "center",
        justifyContent: "center",
        marginRight: rpx(8),
        flexShrink: 0,
    },
    qualityBadge: {
        maxWidth: rpx(74),
        minHeight: rpx(32),
        paddingHorizontal: rpx(9),
        borderRadius: rpx(16),
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        marginRight: rpx(8),
        flexShrink: 0,
    },
    metaText: {
        flex: 1,
        minWidth: 0,
    },
    progressRow: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: rpx(22),
    },
    progressTrack: {
        flex: 1,
        height: rpx(7),
        borderRadius: rpx(4),
        marginHorizontal: rpx(12),
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        borderRadius: rpx(4),
    },
    playButton: {
        width: rpx(72),
        height: rpx(72),
        borderRadius: rpx(36),
        marginLeft: rpx(14),
        alignItems: "center",
        justifyContent: "center",
    },
    emptyCard: {
        minHeight: rpx(116),
        marginHorizontal: rpx(24),
        padding: rpx(14),
        borderRadius: rpx(18),
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
    },
    quickPill: {
        flex: 1,
        minWidth: 0,
        minHeight: rpx(78),
        borderRadius: rpx(16),
        marginHorizontal: rpx(4),
        paddingHorizontal: rpx(10),
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
    },
    quickPillText: {
        marginLeft: rpx(8),
        flexShrink: 1,
    },
});

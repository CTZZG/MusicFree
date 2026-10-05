import FastImage from "@/components/base/fastImage";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import LargeTitleScrollView from "@/components/base/largeTitleScrollView";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import { ImgAsset } from "@/constants/assetsConst";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import type { Plugin } from "@/core/pluginManager";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import TrackPlayer, { useMusicState, useProgress } from "@/core/trackPlayer";
import useColors from "@/hooks/useColors";
import useResolvedMusicArtwork from "@/hooks/useResolvedMusicArtwork";
import useRecommendSheets from "@/pages/recommendSheets/hooks/useRecommendSheets";
import { RequestStateCode } from "@/constants/commonConst";
import { musicIsPaused } from "@/utils/trackUtils";
import React, { ReactNode, useMemo } from "react";
import {
    Pressable,
    ScrollView,
    StyleSheet,
    useWindowDimensions,
    View,
} from "react-native";
import { getShelfTileWidth, PAGE_MARGIN, TILE_GAP } from "@/utils/tileLayout";
import useHomeDiscovery from "./useHomeDiscovery";
import useHomeDiscoverySource from "./useHomeDiscoverySource";
import useHomeOverview from "./useHomeOverview";

const PAGE_PADDING = PAGE_MARGIN;
const RECOMMEND_LIMIT = 10;
// 横排的封面按屏宽算：推荐歌单一屏露出两个半，最近播放小一号、露出三个多
const SHEET_SHELF = { visible: 2.6, min: 100, max: 156 };
const RECENT_SHELF = { visible: 3.2, min: 88, max: 120 };
// 榜单卡片一屏露出一张多一点
const CHART_CARD_MAX_WIDTH = 260;
const CHART_CARD_WIDTH_RATIO = 0.72;

function formatTime(value?: number) {
    if (!value || !Number.isFinite(value) || value < 0) {
        return "0:00";
    }
    const totalSeconds = Math.floor(value);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = `${totalSeconds % 60}`.padStart(2, "0");
    return `${minutes}:${seconds}`;
}

/** 首页 iOS 风格：大标题、继续听、推荐歌单、榜单、最近播放 */
export default function HomeOverview() {
    const { t } = useI18N();
    const data = useHomeOverview();
    const { plugin, candidates } = useHomeDiscoverySource();
    const hideHomeDiscovery = useAppConfig("theme.hideHomeDiscovery") ?? false;
    const hideHomeHeroCard = useAppConfig("theme.hideHomeHeroCard") ?? false;
    const hideHomeRecentListening =
        useAppConfig("theme.hideHomeRecentListening") ?? false;
    const hideHomeOperations = useAppConfig("theme.hideHomeOperations") ?? false;

    return (
        <LargeTitleScrollView
            translucentChrome
            title={t("tabs.home")}
            subtitle={t("home.subtitle")}
            actions={
                !hideHomeDiscovery && plugin ? (
                    <SourcePill plugin={plugin} candidates={candidates} />
                ) : null
            }>
            {!hideHomeHeroCard ? (
                <ContinueListening
                    currentMusic={data.currentMusic}
                    featuredMusic={data.featuredMusic}
                />
            ) : null}
            {!hideHomeDiscovery && plugin ? (
                <>
                    <RecommendSheets plugin={plugin} />
                    <TopLists plugin={plugin} />
                </>
            ) : null}
            {!hideHomeRecentListening ? (
                <RecentListening musics={data.recentMusics} />
            ) : null}
            {!hideHomeOperations ? <QuickAccess /> : null}
        </LargeTitleScrollView>
    );
}

/** 大标题右侧的音源切换：推荐歌单和榜单都取自这个插件 */
function SourcePill(props: { plugin: Plugin; candidates: Plugin[] }) {
    const { plugin, candidates } = props;
    const colors = useColors();
    const { t } = useI18N();

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("home.discoverySource.a11y", {
                name: plugin.name,
            })}
            disabled={candidates.length < 2}
            onPress={() => {
                showDialog("RadioDialog", {
                    title: t("home.discoverySource"),
                    content: candidates.map(item => ({
                        title: item.name,
                        value: item.name,
                        label: item.name,
                    })),
                    defaultSelected: plugin.name,
                    onOk(value) {
                        Config.setConfig(
                            "theme.homeDiscoverySource",
                            value as string,
                        );
                    },
                });
            }}
            style={({ pressed }) => [
                styles.sourcePill,
                { backgroundColor: colors.placeholder },
                pressed ? styles.pressed : null,
            ]}>
            <ThemeText
                numberOfLines={1}
                fontSize="subTitle"
                fontWeight="semibold"
                fontColor="primary"
                style={styles.sourceName}>
                {plugin.name}
            </ThemeText>
            {candidates.length > 1 ? (
                <Icon name="chevron-down" size={15} color={colors.primary} />
            ) : null}
        </Pressable>
    );
}

/** 分区标题：20pt 粗体，右侧“全部” */
function SectionHeader(props: { title: string; onSeeAll?: () => void }) {
    const { t } = useI18N();

    return (
        <View style={styles.sectionHeader}>
            <ThemeText
                accessibilityRole="header"
                fontWeight="bold"
                style={styles.sectionTitle}>
                {props.title}
            </ThemeText>
            {props.onSeeAll ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${props.title}，${t("home.seeAll")}`}
                    hitSlop={10}
                    onPress={props.onSeeAll}
                    style={({ pressed }) => (pressed ? styles.pressed : null)}>
                    <ThemeText fontSize="title" fontColor="primary">
                        {t("home.seeAll")}
                    </ThemeText>
                </Pressable>
            ) : null}
        </View>
    );
}

function Carousel(props: { children: ReactNode; gap?: number }) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
                styles.carousel,
                { gap: props.gap ?? TILE_GAP },
            ]}>
            {props.children}
        </ScrollView>
    );
}

/** 加载中的占位块 */
function Placeholders(props: { count: number; width: number; height: number; radius: number }) {
    const colors = useColors();
    return (
        <>
            {Array.from({ length: props.count }, (_, index) => (
                <View
                    key={index}
                    style={{
                        width: props.width,
                        height: props.height,
                        borderRadius: props.radius,
                        backgroundColor: colors.placeholder,
                    }}
                />
            ))}
        </>
    );
}

function ContinueListening(props: {
    currentMusic: IMusic.IMusicItem | null;
    featuredMusic: IMusic.IMusicItem | null;
}) {
    const { currentMusic, featuredMusic } = props;
    // 进度/播放态是高频更新源，只在这个卡片里订阅，免得整个首页每秒重渲染
    const musicState = useMusicState();
    const { position, duration } = useProgress();
    const colors = useColors();
    const { t } = useI18N();
    const navigate = useNavigate();
    const resolvedArtwork = useResolvedMusicArtwork(featuredMusic);

    if (!featuredMusic) {
        return (
            <View
                style={[
                    styles.card,
                    styles.emptyCard,
                    { backgroundColor: colors.card },
                ]}>
                <EmptyAction
                    icon="inbox-arrow-down"
                    title={t("home.importPlaylist.a11y")}
                    onPress={() => showPanel("ImportMusicSheet")}
                />
                <EmptyAction
                    icon="folder-music-outline"
                    title={t("home.scanLocal")}
                    onPress={() => navigate(ROUTE_PATH.LOCAL)}
                />
            </View>
        );
    }

    const isCurrent =
        !!currentMusic &&
        currentMusic.platform === featuredMusic.platform &&
        currentMusic.id === featuredMusic.id;
    const isPlaying = isCurrent && !musicIsPaused(musicState);
    const total = isCurrent
        ? duration || featuredMusic.duration
        : featuredMusic.duration;
    const elapsed = isCurrent ? position : 0;
    const ratio = total ? Math.min(1, Math.max(0, elapsed / total)) : 0;

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("home.continueListening")}，${featuredMusic.title}，${featuredMusic.artist ?? ""}`}
            onPress={() => {
                if (isCurrent) {
                    navigate(ROUTE_PATH.MUSIC_DETAIL);
                } else {
                    TrackPlayer.play(featuredMusic);
                }
            }}
            style={({ pressed }) => [
                styles.card,
                styles.continueCard,
                { backgroundColor: pressed ? colors.listActive : colors.card },
            ]}>
            <FastImage
                source={resolvedArtwork ?? featuredMusic.artwork}
                placeholderSource={ImgAsset.albumDefault}
                style={styles.continueCover}
            />
            <View style={styles.continueTexts}>
                {/* 标签和播放时间并成一行，卡片少一行高 */}
                <ThemeText
                    numberOfLines={1}
                    fontSize="tag"
                    fontWeight="semibold"
                    fontColor="textSecondary"
                    style={styles.tabular}>
                    {`${t("home.continueListening")} · ${formatTime(
                        elapsed,
                    )} / ${formatTime(total)}`}
                </ThemeText>
                <ThemeText
                    numberOfLines={1}
                    fontSize="title"
                    fontWeight="semibold"
                    style={styles.continueTitle}>
                    {featuredMusic.title}
                </ThemeText>
                {featuredMusic.artist ? (
                    <ThemeText
                        numberOfLines={1}
                        fontColor="textSecondary"
                        style={styles.continueArtist}>
                        {featuredMusic.artist}
                    </ThemeText>
                ) : null}
                <View
                    style={[
                        styles.progressTrack,
                        { backgroundColor: colors.placeholder },
                    ]}>
                    <View
                        style={[
                            styles.progressFill,
                            {
                                width: `${ratio * 100}%`,
                                backgroundColor: colors.primary,
                            },
                        ]}
                    />
                </View>
            </View>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("musicBar.playPause.a11y")}
                onPress={() => {
                    if (isPlaying) {
                        TrackPlayer.pause();
                    } else {
                        TrackPlayer.play(featuredMusic);
                    }
                }}
                style={({ pressed }) => [
                    styles.playButton,
                    { backgroundColor: colors.primary },
                    pressed ? styles.pressed : null,
                ]}>
                <Icon
                    name={isPlaying ? "pause" : "play"}
                    size={22}
                    color="#FFFFFF"
                />
            </Pressable>
        </Pressable>
    );
}

function EmptyAction(props: {
    icon: IIconName;
    title: string;
    onPress: () => void;
}) {
    const colors = useColors();
    return (
        <Pressable
            accessibilityRole="button"
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.emptyAction,
                { backgroundColor: colors.placeholder },
                pressed ? styles.pressed : null,
            ]}>
            <Icon name={props.icon} size={20} color={colors.primary} />
            <ThemeText
                numberOfLines={1}
                fontSize="subTitle"
                fontWeight="semibold"
                fontColor="primary">
                {props.title}
            </ThemeText>
        </Pressable>
    );
}

const DEFAULT_RECOMMEND_TAG = { id: "", title: "" };

function RecommendSheets(props: { plugin: Plugin }) {
    const { plugin } = props;
    const { t } = useI18N();
    const navigate = useNavigate();
    const { width: windowWidth } = useWindowDimensions();
    const tileWidth = getShelfTileWidth(windowWidth, SHEET_SHELF);
    const supported = plugin.supportedMethods.has("getRecommendSheetsByTag");
    const [query, sheets, requestState] = useRecommendSheets(
        supported ? plugin.hash : "",
        DEFAULT_RECOMMEND_TAG,
    );
    const items = useMemo(() => sheets.slice(0, RECOMMEND_LIMIT), [sheets]);

    if (!supported) {
        return null;
    }
    const loading =
        requestState === RequestStateCode.IDLE ||
        requestState === RequestStateCode.PENDING_FIRST_PAGE;
    const failed = requestState === RequestStateCode.ERROR && !items.length;
    if (!loading && !failed && !items.length) {
        return null;
    }

    return (
        <View style={styles.section}>
            <SectionHeader
                title={t("home.recommendSheet")}
                onSeeAll={() =>
                    navigate(ROUTE_PATH.RECOMMEND_SHEETS, {
                        initialPluginHash: plugin.hash,
                    })
                }
            />
            {failed ? (
                <RetryLine onRetry={query} />
            ) : (
                <Carousel>
                    {items.length ? (
                        items.map((sheet, index) => (
                            <Pressable
                                key={`${sheet.id ?? index}`}
                                accessibilityRole="button"
                                accessibilityLabel={sheet.title}
                                onPress={() =>
                                    navigate(ROUTE_PATH.PLUGIN_SHEET_DETAIL, {
                                        pluginHash: plugin.hash,
                                        sheetInfo: sheet,
                                    })
                                }
                                style={({ pressed }) => [
                                    { width: tileWidth },
                                    pressed ? styles.pressed : null,
                                ]}>
                                <FastImage
                                    source={sheet.coverImg ?? sheet.artwork}
                                    placeholderSource={ImgAsset.albumDefault}
                                    style={[
                                        styles.sheetCover,
                                        { width: tileWidth, height: tileWidth },
                                    ]}
                                />
                                <ThemeText
                                    numberOfLines={2}
                                    fontSize="subTitle"
                                    fontWeight="medium"
                                    style={styles.tileTitle}>
                                    {sheet.title ?? t("common.unknownName")}
                                </ThemeText>
                            </Pressable>
                        ))
                    ) : (
                        <Placeholders
                            count={3}
                            width={tileWidth}
                            height={tileWidth}
                            radius={12}
                        />
                    )}
                </Carousel>
            )}
        </View>
    );
}

function TopLists(props: { plugin: Plugin }) {
    const { plugin } = props;
    const { t } = useI18N();
    const colors = useColors();
    const navigate = useNavigate();
    const preview = useHomeDiscovery(plugin);
    const { width: windowWidth } = useWindowDimensions();
    const chartWidth = Math.min(
        CHART_CARD_MAX_WIDTH,
        Math.round(windowWidth * CHART_CARD_WIDTH_RATIO),
    );

    if (!plugin.supportedMethods.has("getTopLists")) {
        return null;
    }
    if (!preview.loading && !preview.topLists.length && !preview.hasError) {
        return null;
    }

    return (
        <View style={styles.section}>
            <SectionHeader
                title={t("home.topList")}
                onSeeAll={() =>
                    navigate(ROUTE_PATH.TOP_LIST, {
                        initialPluginHash: plugin.hash,
                    })
                }
            />
            {preview.hasError && !preview.topLists.length ? (
                <ThemeText
                    fontSize="subTitle"
                    fontColor="textSecondary"
                    style={styles.inlineMessage}>
                    {t("common.failToLoad")}
                </ThemeText>
            ) : (
                <Carousel>
                    {preview.topLists.length ? (
                        preview.topLists.map((topList, index) => (
                            <Pressable
                                key={`${topList.id ?? index}`}
                                accessibilityRole="button"
                                accessibilityLabel={topList.title}
                                onPress={() =>
                                    navigate(ROUTE_PATH.TOP_LIST_DETAIL, {
                                        pluginHash: plugin.hash,
                                        topList,
                                    })
                                }
                                style={({ pressed }) => [
                                    styles.chartCard,
                                    {
                                        width: chartWidth,
                                        backgroundColor: pressed
                                            ? colors.listActive
                                            : colors.card,
                                    },
                                ]}>
                                <FastImage
                                    source={topList.coverImg ?? topList.artwork}
                                    placeholderSource={ImgAsset.albumDefault}
                                    style={styles.chartCover}
                                />
                                <View style={styles.chartTexts}>
                                    <ThemeText
                                        numberOfLines={1}
                                        fontSize="title"
                                        fontWeight="bold">
                                        {topList.title ??
                                            t("common.unknownName")}
                                    </ThemeText>
                                    <ThemeText
                                        numberOfLines={2}
                                        fontSize="description"
                                        fontColor="textSecondary">
                                        {topList.description || plugin.name}
                                    </ThemeText>
                                </View>
                                <Icon
                                    name="chevron-right"
                                    size={16}
                                    color={colors.textSecondary}
                                />
                            </Pressable>
                        ))
                    ) : (
                        <Placeholders
                            count={2}
                            width={chartWidth}
                            height={72}
                            radius={16}
                        />
                    )}
                </Carousel>
            )}
        </View>
    );
}

function RetryLine(props: { onRetry: () => void }) {
    const { t } = useI18N();
    return (
        <Pressable
            accessibilityRole="button"
            onPress={props.onRetry}
            style={styles.inlineMessage}>
            <ThemeText fontSize="subTitle" fontColor="textSecondary">
                {`${t("common.failToLoad")} · `}
                <ThemeText fontSize="subTitle" fontColor="primary">
                    {t("common.retry")}
                </ThemeText>
            </ThemeText>
        </Pressable>
    );
}

function RecentListening(props: { musics: IMusic.IMusicItem[] }) {
    const { musics } = props;
    const { t } = useI18N();
    const navigate = useNavigate();
    const { width: windowWidth } = useWindowDimensions();
    const tileWidth = getShelfTileWidth(windowWidth, RECENT_SHELF);

    if (!musics.length) {
        return null;
    }

    return (
        <View style={styles.section}>
            <SectionHeader
                title={t("home.recentListening")}
                onSeeAll={() => navigate(ROUTE_PATH.HISTORY)}
            />
            <Carousel>
                {musics.map(musicItem => (
                    <Pressable
                        key={`${musicItem.platform}-${musicItem.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${musicItem.title}，${musicItem.artist ?? ""}`}
                        onPress={() => TrackPlayer.play(musicItem)}
                        style={({ pressed }) => [
                            { width: tileWidth },
                            pressed ? styles.pressed : null,
                        ]}>
                        <FastImage
                            source={musicItem.artwork}
                            placeholderSource={ImgAsset.albumDefault}
                            style={[
                                styles.recentCover,
                                { width: tileWidth, height: tileWidth },
                            ]}
                        />
                        <ThemeText
                            numberOfLines={1}
                            fontSize="description"
                            fontWeight="medium"
                            style={styles.tileTitle}>
                            {musicItem.title}
                        </ThemeText>
                        <ThemeText
                            numberOfLines={1}
                            fontSize="tag"
                            fontColor="textSecondary">
                            {musicItem.artist}
                        </ThemeText>
                    </Pressable>
                ))}
            </Carousel>
        </View>
    );
}

/** 快捷入口：资料库、设置里没有的几个常用动作 */
function QuickAccess() {
    const colors = useColors();
    const { t } = useI18N();
    const navigate = useNavigate();

    const items: { key: string; icon: IIconName; title: string; action: () => void }[] = [
        {
            key: "recommend",
            icon: "fire-outline",
            title: t("home.recommendSheet"),
            action: () => navigate(ROUTE_PATH.RECOMMEND_SHEETS),
        },
        {
            key: "topList",
            icon: "trophy",
            title: t("home.topList"),
            action: () => navigate(ROUTE_PATH.TOP_LIST),
        },
        {
            key: "sheetManage",
            icon: "pencil-square",
            title: t("home.managePlaylists.short"),
            action: () =>
                navigate(ROUTE_PATH.SHEET_EDITOR, { sheetType: "local" }),
        },
        {
            key: "sourceManage",
            icon: "javascript",
            title: t("home.manageSources.short"),
            action: () => navigate(ROUTE_PATH.SETTING, { type: "plugin" }),
        },
        {
            key: "playById",
            icon: "identification",
            title: t("home.playById.short"),
            action: () => showPanel("PlayById"),
        },
    ];

    return (
        <View style={styles.section}>
            <SectionHeader title={t("home.quickAccess")} />
            <Carousel gap={10}>
                {items.map(item => (
                    <Pressable
                        key={item.key}
                        accessibilityRole="button"
                        onPress={item.action}
                        style={({ pressed }) => [
                            styles.quickChip,
                            { backgroundColor: colors.card },
                            pressed ? styles.pressed : null,
                        ]}>
                        <Icon name={item.icon} size={18} color={colors.primary} />
                        <ThemeText numberOfLines={1} fontSize="subTitle">
                            {item.title}
                        </ThemeText>
                    </Pressable>
                ))}
            </Carousel>
        </View>
    );
}

const styles = StyleSheet.create({
    pressed: {
        opacity: 0.6,
    },
    sourcePill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        height: 34,
        maxWidth: 160,
        paddingLeft: 14,
        paddingRight: 11,
        borderRadius: 17,
    },
    sourceName: {
        flexShrink: 1,
    },
    section: {
        marginTop: 24,
    },
    sectionHeader: {
        flexDirection: "row",
        alignItems: "baseline",
        justifyContent: "space-between",
        paddingHorizontal: PAGE_PADDING,
        paddingBottom: 10,
    },
    sectionTitle: {
        fontSize: 20,
        lineHeight: 25,
    },
    carousel: {
        paddingHorizontal: PAGE_PADDING,
    },
    card: {
        marginTop: 16,
        marginHorizontal: PAGE_PADDING,
        borderRadius: 16,
    },
    emptyCard: {
        flexDirection: "row",
        gap: 10,
        padding: 12,
    },
    emptyAction: {
        flex: 1,
        height: 44,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingHorizontal: 10,
    },
    continueCard: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 10,
    },
    continueCover: {
        width: 60,
        height: 60,
        borderRadius: 10,
    },
    continueTexts: {
        flex: 1,
        minWidth: 0,
    },
    continueTitle: {
        marginTop: 2,
    },
    continueArtist: {
        fontSize: 14,
        lineHeight: 19,
    },
    progressTrack: {
        marginTop: 8,
        height: 4,
        borderRadius: 2,
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
        borderRadius: 2,
    },
    tabular: {
        fontVariant: ["tabular-nums"],
    },
    playButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
    },
    sheetCover: {
        borderRadius: 12,
    },
    tileTitle: {
        marginTop: 8,
    },
    chartCard: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 16,
    },
    chartCover: {
        width: 48,
        height: 48,
        borderRadius: 10,
    },
    chartTexts: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    recentCover: {
        borderRadius: 10,
    },
    quickChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 36,
        paddingHorizontal: 12,
        borderRadius: 18,
    },
    inlineMessage: {
        paddingHorizontal: PAGE_PADDING,
        paddingVertical: 8,
    },
});

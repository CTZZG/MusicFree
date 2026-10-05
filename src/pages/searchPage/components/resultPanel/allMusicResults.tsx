import React, { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import ThemeText from "@/components/base/themeText";
import Icon from "@/components/base/icon";
import MusicItem, { MUSIC_ITEM_ARTWORK_TEXT_INSET } from "@/components/mediaItem/musicItem";
import ListEmpty from "@/components/base/listEmpty";
import { showPanel } from "@/components/panels/usePanel";
import { RequestStateCode } from "@/constants/commonConst";
import Config from "@/core/appConfig";
import searchSession from "@/core/search";
import { aggregateMusicResults, MusicResultSource } from "@/core/search/aggregateMusicResults";
import TrackPlayer from "@/core/trackPlayer";
import { useI18N } from "@/core/i18n";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";
import { withAccessibilitySuffixes } from "@/utils/a11yLabels";
import useColors from "@/hooks/useColors";
import { useSearchSessionId, useSearchTypeResults } from "../../hooks/useSearchSession";

export default function AllMusicResults(props: { sources: readonly MusicResultSource[] }) {
    const results = useSearchTypeResults("music");
    const sessionId = useSearchSessionId();
    const { t } = useI18N();
    const colors = useColors();
    const bottom = useMusicBarFloatingOffset(16);
    const { sources } = props;
    useEffect(() => {
        sources.forEach(source => searchSession.ensureLoaded("music", source.hash));
    }, [sources, sessionId]);
    const groups = useMemo(() => aggregateMusicResults(sources, results), [sources, results]);
    // 排在第一个的来源就是这一行显示的那首（行里的来源标签），这里只列其余的
    const otherSourcesText = (group: (typeof groups)[number]) => t("searchPage.otherSources", {
        names: group.choices.slice(1).map(choice => choice.source.name).join(t("searchPage.sourceSeparator")),
    });
    const play = (musicItem: IMusic.IMusicItem) => {
        if (searchSession.getSnapshot().id !== sessionId) {
            return;
        }
        if (Config.getConfig("basic.clickMusicInSearch") === "playMusicAndReplace") {
            const selectedGroup = groups.find(group => group.choices.some(choice => choice.musicItem === musicItem));
            const selectedPlaylist = groups.map(group => group === selectedGroup ? musicItem : group.choices[0].musicItem);
            TrackPlayer.playWithReplacePlayList(musicItem, selectedPlaylist);
        } else {
            TrackPlayer.play(musicItem);
        }
    };
    const pending = sources.some(source => !results[source.hash] ||
        [RequestStateCode.PENDING_FIRST_PAGE, RequestStateCode.PENDING_REST_PAGE].includes(results[source.hash]!.state));
    const canLoadMore = sources.some(source => results[source.hash]?.state === RequestStateCode.PARTLY_DONE);
    // 列表顶上只列出失败的来源（可以重试）。各来源加载中、结果数在上面的来源标签里已经有了；
    // 以前每个来源都占一行，再加两行说明，默认的搜索结果第一屏几乎看不到歌
    const failedSources = sources.filter(source => results[source.hash]?.state === RequestStateCode.ERROR);
    return (
        <FlashList
            data={groups}
            keyExtractor={group => group.key}
            contentContainerStyle={{ paddingBottom: bottom }}
            ListHeaderComponent={failedSources.length ? (
                <View style={styles.header}>
                    {failedSources.map(source => {
                        const reason = results[source.hash]?.failure?.kind === "timeout"
                            ? t("searchPage.sourceTimeoutShort")
                            : t("common.failToLoad");
                        return (
                            <Pressable
                                key={source.hash}
                                style={styles.source}
                                accessibilityRole="button"
                                accessibilityLabel={withAccessibilitySuffixes(source.name, [reason, t("common.retry")])}
                                onPress={() => searchSession.retry("music", source.hash)}>
                                <ThemeText style={styles.sourceText} numberOfLines={2}>
                                    {source.name} · {reason}
                                </ThemeText>
                                <ThemeText fontColor="primary">{t("common.retry")}</ThemeText>
                            </Pressable>
                        );
                    })}
                </View>
            ) : null}
            ListEmptyComponent={<ListEmpty state={pending ? RequestStateCode.PENDING_FIRST_PAGE : RequestStateCode.FINISHED} />}
            ListFooterComponent={canLoadMore ? (
                <Pressable
                    style={styles.more}
                    accessibilityRole="button"
                    onPress={() => sources.forEach(source => searchSession.loadMore("music", source.hash))}>
                    <ThemeText fontColor="primary">{t("searchPage.allMusicMore")}</ThemeText>
                </Pressable>
            ) : null}
            renderItem={({ item: group }) => {
                const primary = group.choices[0].musicItem;
                return (
                    <View>
                        <MusicItem musicItem={primary} showArtwork showQuality showDuration onItemPress={() => play(primary)} />
                        {group.choices.length > 1 ? (
                            // 同一首歌的其他来源：挂在这首歌下面、和歌名对齐，紧贴着它，下一首离得远。
                            // 以前是一整行居中的「选择来源（2 个）」，和上下两首一样远，看不出是哪首歌的
                            <Pressable
                                style={({ pressed }) => [
                                    styles.otherSources,
                                    pressed ? styles.pressed : null,
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={withAccessibilitySuffixes(primary.title, [otherSourcesText(group)])}
                                // 合组规则的说明不占列表的地方，朗读时告诉用户
                                accessibilityHint={t("searchPage.allMusicHint")}
                                onPress={() => showPanel("SimpleSelect", {
                                    header: t("searchPage.chooseSourceHeader", { title: primary.title }),
                                    candidates: group.choices.map(choice => ({
                                        title: `${choice.source.name} · ${choice.musicItem.title}`,
                                        value: choice.musicItem,
                                    })),
                                    onPress: choice => play(choice.value),
                                })}>
                                <View style={styles.otherSourcesLine}>
                                    <Icon name="arrows-left-right" size={14} color={colors.primary} />
                                    <ThemeText
                                        fontSize="description"
                                        fontColor="primary"
                                        // 窄屏、大字体时来源名折到第二行，不截断
                                        numberOfLines={2}
                                        style={styles.otherSourcesText}>
                                        {otherSourcesText(group)}
                                    </ThemeText>
                                    <Icon name="chevron-right" size={12} color={colors.primary} />
                                </View>
                            </Pressable>
                        ) : null}
                    </View>
                );
            }}
        />
    );
}
const styles = StyleSheet.create({
    header: { paddingHorizontal: 16, paddingVertical: 4 },
    source: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
    sourceText: { flex: 1, minWidth: 0 },
    // 点击范围 44 高，字放在最上面贴着歌曲行，空出来的部分在下面，和下一首隔开
    otherSources: {
        minHeight: 44,
        paddingLeft: MUSIC_ITEM_ARTWORK_TEXT_INSET,
        paddingRight: 16,
        paddingTop: 2,
        paddingBottom: 12,
    },
    otherSourcesLine: { flexDirection: "row", alignItems: "center", gap: 4 },
    otherSourcesText: { flexShrink: 1, minWidth: 0 },
    pressed: { opacity: 0.6 },
    more: { minHeight: 48, alignItems: "center", justifyContent: "center", padding: 12 },
});

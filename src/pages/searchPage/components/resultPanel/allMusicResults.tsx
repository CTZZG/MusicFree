import React, { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { FlashList } from "@shopify/flash-list";
import ThemeText from "@/components/base/themeText";
import MusicItem from "@/components/mediaItem/musicItem";
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
import { useSearchSessionId, useSearchTypeResults } from "../../hooks/useSearchSession";

export default function AllMusicResults(props: { sources: readonly MusicResultSource[] }) {
    const results = useSearchTypeResults("music");
    const sessionId = useSearchSessionId();
    const { t } = useI18N();
    const bottom = useMusicBarFloatingOffset(16);
    const { sources } = props;
    useEffect(() => {
        sources.forEach(source => searchSession.ensureLoaded("music", source.hash));
    }, [sources, sessionId]);
    const groups = useMemo(() => aggregateMusicResults(sources, results), [sources, results]);
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
                            <Pressable
                                style={styles.choices}
                                accessibilityRole="button"
                                accessibilityLabel={`${primary.title}, ${t("searchPage.chooseSource", { count: group.choices.length })}`}
                                // 合组规则的说明不占列表的地方，朗读时告诉用户
                                accessibilityHint={t("searchPage.allMusicHint")}
                                onPress={() => showPanel("SimpleSelect", {
                                    header: t("searchPage.allMusic"),
                                    candidates: group.choices.map(choice => ({
                                        title: `${choice.source.name} · ${choice.musicItem.title}`,
                                        value: choice.musicItem,
                                    })),
                                    onPress: choice => play(choice.value),
                                })}>
                                <ThemeText fontColor="primary">{t("searchPage.chooseSource", { count: group.choices.length })}</ThemeText>
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
    choices: { minHeight: 44, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 8 },
    more: { minHeight: 48, alignItems: "center", justifyContent: "center", padding: 12 },
});

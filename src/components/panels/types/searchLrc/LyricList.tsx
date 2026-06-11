import Loading from "@/components/base/loading";
import Button from "@/components/base/textButton";
import ThemeText from "@/components/base/themeText";
import LyricItem from "@/components/mediaItem/LyricItem";
import { RequestStateCode } from "@/constants/commonConst";
import lyricManager from "@/core/lyricManager";
import PluginManager from "@/core/pluginManager";
import TrackPlayer from "@/core/trackPlayer";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import { autoDecryptLyric } from "@/utils/musicDecrypter";
import React, { memo, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { hidePanel } from "../../usePanel";
import searchResultStore, { ISearchLyricResult } from "./searchResultStore";
import ListEmpty from "@/components/base/listEmpty";
import ListFooter from "@/components/base/listFooter";
import { FlashList } from "@shopify/flash-list";
import { useI18N } from "@/core/i18n";
import useColors from "@/hooks/useColors";

interface ILyricListWrapperProps {
    route: {
        key: string;
        title: string;
    };
}
export default function LyricListWrapper(props: ILyricListWrapperProps) {
    const hash = props.route.key;
    const dataStore = searchResultStore.useValue();
    return <LyricList data={dataStore.data[hash]} pluginHash={hash} />;
}

interface ILyricListProps {
    data: ISearchLyricResult;
    pluginHash: string;
}

interface IPreviewState {
    itemKey?: string;
    loading: boolean;
    lines: string[];
    error?: boolean;
}

function normalizeText(text?: string | number | null) {
    return `${text ?? ""}`
        .toLowerCase()
        .replace(/[\s\-_.·・,，、/\\|｜&()（）[\]【】《》<>]/g, "");
}

function getLyricItemKey(item: ILyric.ILyricItem) {
    return `${item.platform}@${item.id}`;
}

function getMatchLabel(
    lyricItem: ILyric.ILyricItem,
    currentMusic: IMusic.IMusicItem | null,
    t: ReturnType<typeof useI18N>["t"],
) {
    const title = normalizeText(lyricItem.title);
    const artist = normalizeText(lyricItem.artist);
    const targetTitles = [
        currentMusic?.title,
        currentMusic?.alias,
    ].map(normalizeText).filter(Boolean);
    const targetArtist = normalizeText(currentMusic?.artist);

    const titleMatched = !!title && targetTitles.includes(title);
    const artistMatched = !!artist && !!targetArtist && artist === targetArtist;

    if (titleMatched && artistMatched) {
        return t("panel.searchLrc.match.exact");
    }
    if (titleMatched) {
        return t("panel.searchLrc.match.title");
    }
    if (artistMatched) {
        return t("panel.searchLrc.match.artist");
    }
    return t("panel.searchLrc.match.possible");
}

function stripLyricMarkup(line: string) {
    return line
        .replace(/\[[^\]]*]/g, "")
        .replace(/<\d+[^>]*>/g, "")
        .replace(/\(\d+,\d+(?:,\d+)?\)/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

async function getPreviewLines(source: ILyric.ILyricSource | null) {
    const content =
        source?.rawLrc || source?.translation || source?.romanization || "";
    if (!content) {
        return [];
    }

    const decryptedContent = await autoDecryptLyric(content, false);
    return decryptedContent
        .split(/\r?\n/)
        .map(stripLyricMarkup)
        .filter(Boolean)
        .slice(0, 5);
}

function LyricListImpl(props: ILyricListProps) {
    const data = props.data;
    const { pluginHash } = props;
    const searchState = data?.state ?? RequestStateCode.IDLE;
    const [previewState, setPreviewState] = useState<IPreviewState>({
        loading: false,
        lines: [],
    });

    const { t } = useI18N();
    const colors = useColors();
    const currentMusic = TrackPlayer.currentMusic;

    const matchLabelMap = useMemo(() => {
        const result: Record<string, string> = {};
        data?.data?.forEach(item => {
            result[getLyricItemKey(item)] = getMatchLabel(item, currentMusic, t);
        });
        return result;
    }, [data?.data, currentMusic, t]);

    const associateLyric = useCallback((item: ILyric.ILyricItem) => {
        try {
            const currentMusicItem = TrackPlayer.currentMusic;
            if (!currentMusicItem) {
                return;
            }

            lyricManager.associateLyric(currentMusicItem, item);
            Toast.success(t("panel.searchLrc.toast.settingSuccess"));
            hidePanel();
            // 触发刷新歌词
        } catch {
            Toast.warn(t("panel.searchLrc.toast.failToSearch"));
        }
    }, [t]);

    const previewLyric = useCallback(async (item: ILyric.ILyricItem) => {
        const itemKey = getLyricItemKey(item);
        if (previewState.itemKey === itemKey && !previewState.loading) {
            setPreviewState({
                loading: false,
                lines: [],
            });
            return;
        }

        setPreviewState({
            itemKey,
            loading: true,
            lines: [],
        });

        try {
            const plugin =
                PluginManager.getByHash(pluginHash) ??
                PluginManager.getByMedia(item);
            const source = await plugin?.methods?.getLyric?.(item);
            const lines = await getPreviewLines(source ?? null);
            setPreviewState(prev =>
                prev.itemKey === itemKey
                    ? {
                        itemKey,
                        loading: false,
                        lines,
                    }
                    : prev,
            );
        } catch {
            setPreviewState(prev =>
                prev.itemKey === itemKey
                    ? {
                        itemKey,
                        loading: false,
                        lines: [],
                        error: true,
                    }
                    : prev,
            );
        }
    }, [pluginHash, previewState.itemKey, previewState.loading]);

    return searchState === RequestStateCode.PENDING_FIRST_PAGE ? (
        <Loading />
    ) : (
        <FlashList
            renderItem={({ item }) => {
                const itemKey = getLyricItemKey(item);
                const previewActive = previewState.itemKey === itemKey;

                return (
                    <View>
                        <LyricItem
                            lyricItem={item}
                            matchLabel={matchLabelMap[itemKey]}
                            previewActive={previewActive}
                            onPreview={previewLyric}
                            onPress={associateLyric}
                        />
                        {previewActive ? (
                            <View
                                style={[
                                    styles.preview,
                                    {
                                        backgroundColor: colors.card,
                                        borderColor: colors.divider,
                                    },
                                ]}>
                                {previewState.loading ? (
                                    <View style={styles.previewLoading}>
                                        <ActivityIndicator
                                            animating
                                            color={colors.textSecondary}
                                        />
                                        <ThemeText
                                            fontSize="description"
                                            fontColor="textSecondary">
                                            {t("panel.searchLrc.previewLoading")}
                                        </ThemeText>
                                    </View>
                                ) : previewState.error ? (
                                    <ThemeText
                                        fontSize="description"
                                        fontColor="textSecondary">
                                        {t("panel.searchLrc.previewFailed")}
                                    </ThemeText>
                                ) : previewState.lines.length ? (
                                    <>
                                        {previewState.lines.map((line, index) => (
                                            <ThemeText
                                                key={`${line}-${index}`}
                                                numberOfLines={1}
                                                fontSize="description"
                                                fontColor="textSecondary"
                                                style={styles.previewLine}>
                                                {line}
                                            </ThemeText>
                                        ))}
                                        <View style={styles.previewAction}>
                                            <Button
                                                fontColor="primary"
                                                onPress={() => associateLyric(item)}>
                                                {t("panel.searchLrc.useThisLyric")}
                                            </Button>
                                        </View>
                                    </>
                                ) : (
                                    <ThemeText
                                        fontSize="description"
                                        fontColor="textSecondary">
                                        {t("panel.searchLrc.previewEmpty")}
                                    </ThemeText>
                                )}
                            </View>
                        ) : null}
                    </View>
                );
            }}
            ListEmptyComponent={<ListEmpty state={searchState} />}
            ListFooterComponent={data?.data?.length ? <ListFooter state={searchState} /> : null}
            data={data?.data}
        />
    );
}

const LyricList = memo(LyricListImpl, (prev, curr) => prev.data === curr.data);

const styles = StyleSheet.create({
    preview: {
        marginHorizontal: rpx(24),
        marginBottom: rpx(16),
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(18),
        borderRadius: rpx(12),
        borderWidth: 1,
    },
    previewLoading: {
        minHeight: rpx(48),
        flexDirection: "row",
        alignItems: "center",
        columnGap: rpx(16),
    },
    previewLine: {
        lineHeight: rpx(34),
        marginBottom: rpx(8),
    },
    previewAction: {
        marginTop: rpx(8),
        alignItems: "flex-end",
    },
});

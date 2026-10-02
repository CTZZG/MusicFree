import ListEmpty from "@/components/base/listEmpty";
import ListFooter from "@/components/base/listFooter";
import Loading from "@/components/base/loading";
import MusicList from "@/components/musicList";
import { RequestStateCode } from "@/constants/commonConst";
import Config from "@/core/appConfig";
import searchSession, { type ISearchSourceResult } from "@/core/search";
import TrackPlayer from "@/core/trackPlayer";
import useOrientation from "@/hooks/useOrientation";
import { FlashList } from "@shopify/flash-list";
import React, { memo, useCallback, useEffect, useMemo } from "react";
import { getSourceEmptyState } from "../../common/searchResultMeta";
import { useSearchSessionId } from "../../hooks/useSearchSession";
import { renderMap } from "./results";
import { useI18N } from "@/core/i18n";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";
import { View } from "react-native";
import rpx from "@/utils/rpx";

interface IResultWrapperProps<
    T extends ICommon.SupportMediaType = ICommon.SupportMediaType,
> {
    tab: T;
    pluginHash: string;
    pluginName: string;
    searchResult?: ISearchSourceResult<T>;
    pluginSearchResultRef: React.MutableRefObject<
        ISearchSourceResult<T> | undefined
    >;
}
function ResultWrapper(props: IResultWrapperProps) {
    const {
        tab,
        pluginHash,
        pluginName,
        searchResult,
        pluginSearchResultRef,
    } = props;
    const sessionId = useSearchSessionId();
    // 结果面板只在搜索进行中出现，尚无记录说明首个请求马上就会发出
    const searchState =
        searchResult?.state ?? RequestStateCode.PENDING_FIRST_PAGE;
    const orientation = useOrientation();
    const { t } = useI18N();
    const musicBarBottomInset = useMusicBarFloatingOffset(rpx(24));

    const ResultComponent = renderMap[tab]!;
    const data: any = searchResult?.data ?? [];

    const keyExtractor = useCallback(
        (item: any, i: number) => `${i}-${item.platform}-${item.id}`,
        [],
    );

    // 展示到这个来源时请求第一页；每次新的搜索开始后重新请求
    useEffect(() => {
        searchSession.ensureLoaded(tab, pluginHash);
    }, [pluginHash, sessionId, tab]);

    const renderItem = ({ item, index }: any) => (
        <ResultComponent
            item={item}
            index={index}
            pluginHash={pluginHash}
            pluginSearchResultRef={pluginSearchResultRef}
        />
    );
    const emptyState = useMemo(
        () => getSourceEmptyState(searchResult, pluginName, t),
        [pluginName, searchResult, t],
    );

    // 重试失败的那一页：首页失败重新加载，翻页失败只补那一页，已加载的结果保留
    const retry = useCallback(() => {
        searchSession.retry(tab, pluginHash);
    }, [pluginHash, tab]);

    const refresh = useCallback(() => {
        searchSession.refresh(tab, pluginHash);
    }, [pluginHash, tab]);

    const loadMore = useCallback(() => {
        searchSession.loadMore(tab, pluginHash);
    }, [pluginHash, tab]);

    const onMusicItemPress = useCallback(
        (musicItem: IMusic.IMusicItem, musicList?: IMusic.IMusicItem[]) => {
            const clickBehavior = Config.getConfig("basic.clickMusicInSearch");
            if (clickBehavior === "playMusicAndReplace") {
                TrackPlayer.playWithReplacePlayList(
                    musicItem,
                    musicList?.length ? musicList : [musicItem],
                );
            } else {
                TrackPlayer.play(musicItem);
            }
        },
        [],
    );

    if (tab === "music") {
        return (
            <MusicList
                musicList={data as IMusic.IMusicItem[]}
                state={searchState}
                onRetry={retry}
                emptyTitle={emptyState.title}
                emptyDescription={emptyState.description}
                onLoadMore={loadMore}
                onItemPress={onMusicItemPress}
                showArtwork
            />
        );
    }

    return searchState === RequestStateCode.PENDING_FIRST_PAGE ? (
        <Loading />
    ) : (
        <FlashList
            extraData={searchState}
            ListEmptyComponent={
                <ListEmpty
                    state={searchState}
                    title={emptyState.title}
                    description={emptyState.description}
                    onRetry={retry}
                />
            }
            ListFooterComponent={
                <>
                    {data?.length ? (
                        <ListFooter state={searchState} onRetry={retry} />
                    ) : null}
                    {musicBarBottomInset ? (
                        <View style={{ height: musicBarBottomInset }} />
                    ) : null}
                </>
            }
            data={data}
            refreshing={false}
            onRefresh={refresh}
            onEndReached={loadMore}
            numColumns={
                tab === "sheet" ? (orientation === "vertical" ? 3 : 4) : 1
            }
            renderItem={renderItem}
            keyExtractor={keyExtractor}
        />
    );
}

export default memo(ResultWrapper);

import ListEmpty from "@/components/base/listEmpty";
import ListFooter from "@/components/base/listFooter";
import Loading from "@/components/base/loading";
import MusicList from "@/components/musicList";
import { RequestStateCode } from "@/constants/commonConst";
import Config from "@/core/appConfig";
import TrackPlayer from "@/core/trackPlayer";
import useOrientation from "@/hooks/useOrientation";
import { FlashList } from "@shopify/flash-list";
import { useAtomValue } from "jotai";
import React, {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import useSearch from "../../hooks/useSearch";
import { ISearchResult, queryAtom } from "../../store/atoms";
import { renderMap } from "./results";
import { useI18N } from "@/core/i18n";

interface IResultWrapperProps<
    T extends ICommon.SupportMediaType = ICommon.SupportMediaType,
> {
    tab: T;
    pluginHash: string;
    pluginName: string;
    searchResult: ISearchResult<T>;
    pluginSearchResultRef: React.MutableRefObject<ISearchResult<T>>;
}
function ResultWrapper(props: IResultWrapperProps) {
    const {
        tab,
        pluginHash,
        pluginName,
        searchResult,
        pluginSearchResultRef,
    } = props;
    const search = useSearch();
    const [searchState, setSearchState] = useState<RequestStateCode>(
        searchResult?.state ?? RequestStateCode.IDLE,
    );
    const orientation = useOrientation();
    const query = useAtomValue(queryAtom);
    const { t } = useI18N();
    const didRequestFirstSearchRef = useRef(false);

    const ResultComponent = renderMap[tab]!;
    const data: any = searchResult?.data ?? [];

    const keyExtractor = useCallback(
        (item: any, i: number) => `${i}-${item.platform}-${item.id}`,
        [],
    );

    useEffect(() => {
        if (
            searchState === RequestStateCode.IDLE &&
            !didRequestFirstSearchRef.current
        ) {
            didRequestFirstSearchRef.current = true;
            search(query, 1, tab, pluginHash);
        }
    }, [pluginHash, query, search, searchState, tab]);

    useEffect(() => {
        setSearchState(searchResult?.state ?? RequestStateCode.IDLE);
    }, [searchResult]);

    const renderItem = ({ item, index }: any) => (
        <ResultComponent
            item={item}
            index={index}
            pluginHash={pluginHash}
            pluginSearchResultRef={pluginSearchResultRef}
        />
    );
    const emptyStateText = useMemo(() => {
        if (
            searchState === RequestStateCode.FINISHED ||
            searchState === RequestStateCode.PARTLY_DONE
        ) {
            return {
                title: t("searchPage.sourceEmptyResult", {
                    source: pluginName,
                }),
            };
        }
        if (searchState === RequestStateCode.ERROR) {
            return {
                title: t("searchPage.sourceLoadFailed", {
                    source: pluginName,
                }),
                description: searchResult?.errorMessage,
            };
        }

        return {};
    }, [pluginName, searchResult?.errorMessage, searchState, t]);

    const retry = useCallback(() => {
        search(query, 1, tab, pluginHash);
    }, [pluginHash, query, search, tab]);

    const loadMore = useCallback(() => {
        search(undefined, undefined, tab, pluginHash);
    }, [pluginHash, search, tab]);

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
                emptyTitle={emptyStateText.title}
                emptyDescription={emptyStateText.description}
                onLoadMore={() => {
                    (searchState === RequestStateCode.PARTLY_DONE ||
                        searchState === RequestStateCode.IDLE) &&
                        loadMore();
                }}
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
                    title={emptyStateText.title}
                    description={emptyStateText.description}
                    onRetry={retry}
                />
            }
            ListFooterComponent={data?.length ? <ListFooter state={searchState} onRetry={() => {
                search(query, undefined, tab, pluginHash);
            }} /> : null}
            data={data}
            refreshing={false}
            onRefresh={() => {
                retry();
            }}
            onEndReached={() => {
                (searchState === RequestStateCode.PARTLY_DONE ||
                    searchState === RequestStateCode.IDLE) &&
                    loadMore();
            }}
            numColumns={
                tab === "sheet" ? (orientation === "vertical" ? 3 : 4) : 1
            }
            renderItem={renderItem}
            keyExtractor={keyExtractor}
        />
    );
}

export default memo(ResultWrapper);

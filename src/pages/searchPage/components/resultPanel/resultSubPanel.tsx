import Empty from "@/components/base/empty";
import { RequestStateCode } from "@/constants/commonConst";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
import PluginManager from "@/core/pluginManager";
import useColors from "@/hooks/useColors";
import rpx, { vw } from "@/utils/rpx";
import { useAtomValue } from "jotai";
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SceneMap, TabBar, TabView } from "react-native-tab-view";
import { searchResultsAtom } from "../../store/atoms";
import { renderMap } from "./results";
import DefaultResults from "./results/defaultResults";
import ResultWrapper from "./resultWrapper";
import { useParams } from "@/core/router";

interface IResultSubPanelProps {
    tab: ICommon.SupportMediaType;
}

function getPluginTabMeta(
    searchResult:
        | {
              state?: RequestStateCode;
              data?: unknown[];
          }
        | undefined,
    loadingText: string,
    failedText: string,
) {
    const resultCount = searchResult?.data?.length ?? 0;

    if (
        searchResult?.state === RequestStateCode.PENDING_FIRST_PAGE ||
        searchResult?.state === RequestStateCode.PENDING_REST_PAGE
    ) {
        return resultCount ? `${resultCount}...` : loadingText;
    }

    if (searchResult?.state === RequestStateCode.ERROR) {
        return failedText;
    }

    if (
        searchResult?.state === RequestStateCode.FINISHED ||
        searchResult?.state === RequestStateCode.PARTLY_DONE
    ) {
        return `${resultCount}`;
    }

    return "";
}

// 展示结果的视图
function getResultComponent(
    tab: ICommon.SupportMediaType,
    pluginHash: string,
    pluginName: string,
) {
    return tab in renderMap
        ? memo(
            () => {
                const searchResults = useAtomValue(searchResultsAtom);
                const pluginSearchResult = searchResults[tab][pluginHash];
                const pluginSearchResultRef = useRef(pluginSearchResult);

                useEffect(() => {
                    pluginSearchResultRef.current = pluginSearchResult;
                }, [pluginSearchResult]);

                return (
                    <ResultWrapper
                        tab={tab}
                        searchResult={pluginSearchResult}
                        pluginHash={pluginHash}
                        pluginName={pluginName}
                        pluginSearchResultRef={pluginSearchResultRef}
                    />
                );
            },
            () => true,
        )
        : () => <DefaultResults />;
}

/** 结果scene */
function getSubRouterScene(
    tab: ICommon.SupportMediaType,
    routes: Array<{ key: string; title: string }>,
) {
    const scene: Record<string, React.FC> = {};
    routes.forEach(r => {
        // todo: 是否声明不可搜索
        scene[r.key] = getResultComponent(tab, r.key, r.title);
    });
    return SceneMap(scene);
}

function ResultSubPanel(props: IResultSubPanelProps) {
    const params = useParams<"search-page">();
    const colors = useColors();
    const { t } = useI18N();
    const searchResults = useAtomValue(searchResultsAtom);

    const routes = useMemo(
        () =>
            PluginManager.getSortedSearchablePlugins(props.tab).map(_ => ({
                key: _.hash,
                title: _.name,
            })),
        [props.tab],
    );
    const initialIndex = useMemo(
        () =>
            Math.max(
                routes.findIndex(route => route.key === params?.pluginHash),
                0,
            ),
        [params?.pluginHash, routes],
    );
    const [index, setIndex] = useState(initialIndex);
    const renderScene = useMemo(
        () => getSubRouterScene(props.tab, routes),
        [props.tab, routes],
    );

    useEffect(() => {
        setIndex(initialIndex);
    }, [initialIndex]);

    if (!routes.length) {
        return <Empty />;
    }

    return (
        <TabView
            lazy
            navigationState={{
                index,
                routes,
            }}
            renderTabBar={_ => {
                const options = _.navigationState.routes.reduce(
                    (acc: Record<string, any>, route: { key: string; title?: string }) => {
                        acc[route.key] = {
                            label: ({ focused, color }: any) => {
                                const pluginSearchResult =
                                    searchResults[props.tab][route.key];
                                const meta = getPluginTabMeta(
                                    pluginSearchResult,
                                    t("common.loading"),
                                    t("common.failToLoad"),
                                );
                                const isError =
                                    pluginSearchResult?.state ===
                                    RequestStateCode.ERROR;
                                const metaColor = isError
                                    ? colors.notification
                                    : focused
                                        ? color
                                        : colors.textSecondary;

                                return (
                                    <View style={styles.pluginTabLabel}>
                                        <Text
                                            numberOfLines={1}
                                            style={[
                                                styles.pluginTabTitle,
                                                {
                                                    fontWeight: focused
                                                        ? fontWeightConst.bolder
                                                        : fontWeightConst.medium,
                                                    color,
                                                },
                                            ]}>
                                            {route.title ??
                                                `(${t("common.unknownName")})`}
                                        </Text>
                                        {meta ? (
                                            <Text
                                                numberOfLines={1}
                                                style={[
                                                    styles.pluginTabMeta,
                                                    {
                                                        color: metaColor,
                                                    },
                                                ]}>
                                                {meta}
                                            </Text>
                                        ) : null}
                                    </View>
                                );
                            },
                        };
                        return acc;
                    },
                    {} as Record<string, any>,
                );

                return (
                    <TabBar
                        {..._}
                        scrollEnabled
                        style={styles.tabBar}
                        inactiveColor={colors.text}
                        activeColor={colors.primary}
                        tabStyle={styles.tab}
                        renderIndicator={() => null}
                        pressColor="transparent"
                        options={options}
                    />
                );
            }}
            renderScene={renderScene}
            onIndexChange={setIndex}
            initialLayout={{ width: vw(100) }}
        />
    );
}

// 不然会一直重新渲染
export default memo(ResultSubPanel);

const styles = StyleSheet.create({
    tabBar: {
        backgroundColor: "transparent",
        shadowColor: "transparent",
        borderColor: "transparent",
    },
    tab: {
        width: "auto",
    },
    pluginTabLabel: {
        width: rpx(140),
        alignItems: "center",
        justifyContent: "center",
        rowGap: rpx(4),
    },
    pluginTabTitle: {
        width: "100%",
        textAlign: "center",
    },
    pluginTabMeta: {
        width: "100%",
        fontSize: fontSizeConst.tag,
        textAlign: "center",
    },
});

import AllMusicResults from "./allMusicResults";
import { ALL_MUSIC_SOURCE_KEY } from "@/core/search/aggregateMusicResults";
import { getCategoryTabMeta } from "../../common/searchResultMeta";
import Empty from "@/components/base/empty";
import { useI18N } from "@/core/i18n";
import PluginManager, { usePluginEnabledRevision } from "@/core/pluginManager";
import useColors from "@/hooks/useColors";
import { vw } from "@/utils/rpx";
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { SceneMap, TabBar, TabView } from "react-native-tab-view";
import { withAccessibilitySuffixes } from "@/utils/a11yLabels";
import { getSourceTabMeta } from "../../common/searchResultMeta";
import {
    useSearchSourceResult,
    useSearchTypeResults,
} from "../../hooks/useSearchSession";
import { renderMap } from "./results";
import DefaultResults from "./results/defaultResults";
import ResultTabLabel from "./resultTabLabel";
import ResultWrapper from "./resultWrapper";
import { useParams } from "@/core/router";

interface IResultSubPanelProps {
    tab: ICommon.SupportMediaType;
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
                const pluginSearchResult = useSearchSourceResult(
                    tab,
                    pluginHash,
                );
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
        scene[r.key] = r.key === ALL_MUSIC_SOURCE_KEY
            ? () => <AllMusicResults sources={routes.filter(route => route.key !== ALL_MUSIC_SOURCE_KEY).map(route => ({ hash: route.key, name: route.title }))} />
            : getResultComponent(tab, r.key, r.title);
    });
    return SceneMap(scene);
}

function ResultSubPanel(props: IResultSubPanelProps) {
    const params = useParams<"search-page">();
    const colors = useColors();
    const { t } = useI18N();
    const typeResults = useSearchTypeResults(props.tab);

    // 搜索标签常驻不卸载：插件启用或停用后，来源标签要跟着变
    const enabledRevision = usePluginEnabledRevision();
    const routes = useMemo(
        () => {
            const sourceRoutes = PluginManager.getSortedSearchablePlugins(props.tab).map(plugin => ({ key: plugin.hash, title: plugin.name }));
            return props.tab === "music" && sourceRoutes.length
                ? [{ key: ALL_MUSIC_SOURCE_KEY, title: t("searchPage.allMusic") }, ...sourceRoutes]
                : sourceRoutes;
        },
        // enabledRevision 只用来让结果在启用状态变化后重算
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [props.tab, enabledRevision, t],
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
            // 翻到第一页、最后一页时的边缘回弹没结束，会吃掉下一次点击
            overScrollMode="never"
            lazy
            navigationState={{
                // 停用插件后来源变少，原来选中的位置可能已经越界
                index: Math.min(index, routes.length - 1),
                routes,
            }}
            renderTabBar={_ => {
                const options = _.navigationState.routes.reduce(
                    (acc: Record<string, any>, route: { key: string; title?: string }) => {
                        const title =
                            route.title ?? `(${t("common.unknownName")})`;
                        const meta = route.key === ALL_MUSIC_SOURCE_KEY
                            ? getCategoryTabMeta(Object.fromEntries(Object.entries(typeResults).filter(([key]) => routes.some(candidate => candidate.key === key))), t)
                            : getSourceTabMeta(typeResults[route.key], t);
                        acc[route.key] = {
                            accessibilityLabel: withAccessibilitySuffixes(
                                title,
                                [meta.text],
                            ),
                            label: ({ focused }: any) => (
                                <ResultTabLabel
                                    title={title}
                                    focused={focused}
                                    meta={meta}
                                    tintOnError
                                />
                            ),
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
});

import Empty from "@/components/base/empty";
import { fontWeightConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
import PluginManager from "@/core/pluginManager";
import useColors from "@/hooks/useColors";
import rpx, { vw } from "@/utils/rpx";
import { useAtomValue } from "jotai";
import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { SceneMap, TabBar, TabView } from "react-native-tab-view";
import { searchResultsAtom } from "../../store/atoms";
import { renderMap } from "./results";
import DefaultResults from "./results/defaultResults";
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
            renderTabBar={_ => (
                <TabBar
                    {..._}
                    scrollEnabled
                    style={styles.tabBar}
                    inactiveColor={colors.text}
                    activeColor={colors.primary}
                    tabStyle={styles.tab}
                    renderIndicator={() => null}
                    pressColor="transparent"
                    renderLabel={({ route, focused, color }) => (
                        <Text
                            numberOfLines={1}
                            style={[
                                styles.pluginTabLabel,
                                {
                                    fontWeight: focused
                                        ? fontWeightConst.bolder
                                        : fontWeightConst.medium,
                                    color,
                                },
                            ]}>
                            {route.title ?? `(${t("common.unknownName")})`}
                        </Text>
                    )}
                />
            )}
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
        textAlign: "center",
    },
});

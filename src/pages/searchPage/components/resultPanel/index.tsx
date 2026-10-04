/**
 * 搜索结果面板 一级页
 */
import React, { memo, useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { vw } from "@/utils/rpx";
import { SceneMap, TabBar, TabView } from "react-native-tab-view";
import ResultSubPanel from "./resultSubPanel";
import ResultTabLabel from "./resultTabLabel";
import results from "./results";
import useColors from "@/hooks/useColors";
import { useI18N } from "@/core/i18n";
import { useParams } from "@/core/router";
import { withAccessibilitySuffixes } from "@/utils/a11yLabels";
import { getCategoryTabMeta } from "../../common/searchResultMeta";
import { useSearchResults } from "../../hooks/useSearchSession";

const routes = results;

const getRouterScene = (
    routes: Array<{ key: ICommon.SupportMediaType; title: string }>,
) => {
    const scene: Record<string, () => JSX.Element> = {};
    routes.forEach(r => {
        scene[r.key] = () => <ResultSubPanel tab={r.key} />;
    });
    return SceneMap(scene);
};

const renderScene = getRouterScene(routes);

function ResultPanel() {
    const params = useParams<"search-page">();
    const initialIndex = Math.max(
        routes.findIndex(route => route.key === params?.initialSearchType),
        0,
    );
    const [index, setIndex] = useState(initialIndex);
    const colors = useColors();
    const { t } = useI18N();
    const searchResults = useSearchResults();

    useEffect(() => {
        setIndex(initialIndex);
    }, [initialIndex]);

    return (
        <TabView
            // 翻到第一页、最后一页时的边缘回弹没结束，会吃掉下一次点击
            overScrollMode="never"
            lazy
            navigationState={{
                index,
                routes,
            }}
            renderTabBar={props => {
                const options = props.navigationState.routes.reduce(
                    (acc, route) => {
                        const title = route.i18nKey
                            ? t(route.i18nKey as any)
                            : route.title;
                        const meta = getCategoryTabMeta(
                            searchResults[route.key],
                            t,
                        );
                        acc[route.key] = {
                            // 不给的话读的是路由的 title（写死的中文）
                            accessibilityLabel: withAccessibilitySuffixes(
                                title,
                                [meta.text],
                            ),
                            label: ({ focused }: any) => (
                                <ResultTabLabel
                                    title={title}
                                    focused={focused}
                                    meta={meta}
                                />
                            ),
                        };
                        return acc;
                    },
                    {} as Record<string, any>,
                );

                return (
                    <TabBar
                        {...props}
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

export default memo(ResultPanel);

const styles = StyleSheet.create({
    // 类型切换栏直接铺在页面底色上
    tabBar: {
        backgroundColor: "transparent",
        shadowColor: "transparent",
        borderColor: "transparent",
        elevation: 0,
    },
    tab: {
        width: "auto",
    },
});

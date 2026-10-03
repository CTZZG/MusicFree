/**
 * 搜索结果面板 一级页
 */
import React, { memo, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import rpx, { vw } from "@/utils/rpx";
import { SceneMap, TabBar, TabView } from "react-native-tab-view";
import ResultSubPanel from "./resultSubPanel";
import results from "./results";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import { useI18N } from "@/core/i18n";
import { useParams } from "@/core/router";
import Color from "color";
import { getCategoryTabMeta, type ITabMeta } from "../../common/searchResultMeta";
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
const ERROR_COLOR = "#FC5F5F";

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
                        acc[route.key] = {
                            label: ({ focused }: any) => (
                                <CategoryTabLabel
                                    title={
                                        route.i18nKey
                                            ? t(route.i18nKey as any)
                                            : route.title
                                    }
                                    focused={focused}
                                    meta={getCategoryTabMeta(
                                        searchResults[route.key],
                                        t,
                                    )}
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
                        tabStyle={{
                            width: "auto",
                        }}
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

function CategoryTabLabel(props: {
    title: string;
    focused: boolean;
    meta: ITabMeta;
}) {
    const { title, focused, meta } = props;
    const colors = useColors();
    const textColor = focused
        ? colors.primary
        : colors.textSecondary ?? colors.text;
    const metaColor = meta.isError
        ? ERROR_COLOR
        : focused
            ? colors.primary
            : colors.textSecondary;

    return (
        <View
            style={[
                styles.categoryTabLabel,
                {
                    backgroundColor: focused
                        ? Color(colors.primary).alpha(0.1).toString()
                        : "transparent",
                    borderColor: focused
                        ? Color(colors.primary).alpha(0.28).toString()
                        : "transparent",
                },
            ]}>
            <Text
                numberOfLines={1}
                style={[
                    styles.categoryTabTitle,
                    {
                        fontWeight: focused
                            ? fontWeightConst.bolder
                            : fontWeightConst.medium,
                        color: textColor,
                    },
                ]}>
                {title}
            </Text>
            {meta.text ? (
                <Text
                    numberOfLines={1}
                    style={[
                        styles.categoryTabMeta,
                        {
                            color: metaColor,
                        },
                    ]}>
                    {meta.text}
                </Text>
            ) : null}
        </View>
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
    categoryTabLabel: {
        width: rpx(156),
        minHeight: rpx(72),
        paddingHorizontal: rpx(16),
        paddingVertical: rpx(8),
        borderRadius: rpx(8),
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        rowGap: rpx(2),
    },
    categoryTabTitle: {
        width: "100%",
        textAlign: "center",
    },
    categoryTabMeta: {
        width: "100%",
        fontSize: fontSizeConst.tag,
        textAlign: "center",
    },
});

/**
 * 搜索结果面板 一级页
 */
import React, { memo, useEffect, useState } from "react";
import { Text } from "react-native";
import rpx, { vw } from "@/utils/rpx";
import { SceneMap, TabBar, TabView } from "react-native-tab-view";
import ResultSubPanel from "./resultSubPanel";
import results from "./results";
import { fontWeightConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import { useI18N } from "@/core/i18n";
import { useParams } from "@/core/router";

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

    useEffect(() => {
        setIndex(initialIndex);
    }, [initialIndex]);

    return (
        <TabView
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
                                <Text
                                    numberOfLines={1}
                                    style={{
                                        width: rpx(160),
                                        fontWeight: focused
                                            ? fontWeightConst.bolder
                                            : fontWeightConst.medium,
                                        color: focused
                                            ? colors.primary
                                            : colors.textSecondary ??
                                              colors.text,
                                        textAlign: "center",
                                    }}>
                                    {route.i18nKey
                                        ? t(route.i18nKey as any)
                                        : route.title}
                                </Text>
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
                        style={{
                            backgroundColor: colors.tabBar,
                            shadowColor: "transparent",
                            borderColor: "transparent",
                        }}
                        inactiveColor={colors.text}
                        activeColor={colors.primary}
                        tabStyle={{
                            width: "auto",
                        }}
                        options={options}
                        indicatorStyle={{
                            backgroundColor: colors.primary,
                            height: rpx(4),
                        }}
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

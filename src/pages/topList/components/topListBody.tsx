import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import rpx from "@/utils/rpx";
import PluginManager from "@/core/pluginManager";
import { TabBar, TabView } from "react-native-tab-view";
import TabLabel from "@/components/base/tabLabel";
import BoardPanelWrapper from "./boardPanelWrapper";
import useColors from "@/hooks/useColors";
import NoPlugin from "@/components/base/noPlugin";
import i18n from "@/core/i18n";
import { useParams } from "@/core/router";

export default function TopListBody() {
    const params = useParams<"top-list">();
    const routes = useMemo(
        () =>
            PluginManager.getSortedPluginsWithAbility("getTopLists").map(_ => ({
                key: _.hash,
                title: _.name,
            })),
        [],
    );
    const initialIndex = useMemo(
        () =>
            Math.max(
                0,
                routes.findIndex(route => route.key === params?.initialPluginHash),
            ),
        [params?.initialPluginHash, routes],
    );
    const [index, setIndex] = useState(initialIndex);
    const colors = useColors();

    useEffect(() => {
        setIndex(initialIndex);
    }, [initialIndex]);

    const renderScene = useCallback(
        (props: { route: { key: string } }) => (
            <BoardPanelWrapper hash={props?.route?.key} />
        ),
        [],
    );
    if (!routes?.length) {
        return <NoPlugin notSupportType={i18n.t("topList.title")} />;
    }

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
                                <TabLabel focused={focused} title={route.title} />
                            ),
                        };
                        return acc;
                    },
                    {} as Record<string, any>,
                );

                return (
                    <TabBar
                        {...props}
                        style={styles.tabBarStyle}
                        tabStyle={styles.tabStyle}
                        scrollEnabled
                        inactiveColor={colors.text}
                        activeColor={colors.primary}
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
            initialLayout={{ width: rpx(750) }}
        />
    );
}

const styles = StyleSheet.create({
    tabBarStyle: {
        backgroundColor: "transparent",
        shadowColor: "transparent",
        borderColor: "transparent",
    },
    tabStyle: {
        width: "auto",
    },
});

import NoPlugin from "@/components/base/noPlugin";
import TabLabel from "@/components/base/tabLabel";
import { useI18N } from "@/core/i18n";
import PluginManager from "@/core/pluginManager";
import { useParams } from "@/core/router";
import useColors from "@/hooks/useColors";
import rpx, { vw } from "@/utils/rpx";
import React, { useState } from "react";
import { TabBar, TabView } from "react-native-tab-view";
import SheetBody from "./sheetBody";

export default function Body() {
    const params = useParams<"recommend-sheets">();
    const colors = useColors();
    const routes = PluginManager.getSortedPluginsWithAbility("getRecommendSheetsByTag").map(
        _ => ({
            key: _.hash,
            title: _.name,
        }),
    );
    // 从首页「推荐歌单 · 全部」进来时停在首页选的音源上；找不到就是第一个
    const [index, setIndex] = useState(() =>
        Math.max(
            0,
            routes.findIndex(route => route.key === params?.initialPluginHash),
        ),
    );
    const { t } = useI18N();

    const renderTabBar = (_: any) => {
        const options = _.navigationState.routes.reduce(
            (acc: Record<string, any>, route: { key: string; title?: string }) => {
                acc[route.key] = {
                    label: ({ focused }: any) => (
                        <TabLabel
                            focused={focused}
                            title={route.title ?? `(${t("common.unknownName")})`}
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
                style={{
                    backgroundColor: "transparent",
                    shadowColor: "transparent",
                    borderColor: "transparent",
                }}
                tabStyle={{
                    width: "auto",
                }}
                pressColor="transparent"
                inactiveColor={colors.text}
                activeColor={colors.primary}
                options={options}
                indicatorStyle={{
                    backgroundColor: colors.primary,
                    height: rpx(4),
                }}
            />
        );
    };

    if (!routes?.length) {
        return <NoPlugin notSupportType={t("recommendSheet.title")} />;
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
            renderTabBar={renderTabBar}
            renderScene={props => {
                return <SheetBody hash={props.route.key} />;
            }}
            onIndexChange={setIndex}
            initialLayout={{ width: vw(100) }}
        />
    );
}

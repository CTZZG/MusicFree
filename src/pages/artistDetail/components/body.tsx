import React, { useState } from "react";
import { StyleSheet } from "react-native";
import rpx from "@/utils/rpx";
import { SceneMap, TabBar, TabView } from "react-native-tab-view";
import TabLabel from "@/components/base/tabLabel";
import ResultList from "./resultList";
import { useAtomValue } from "jotai";
import { queryResultAtom } from "../store/atoms";
import content from "./content";
import useColors from "@/hooks/useColors";
import { useI18N } from "@/core/i18n";

const sceneMap: Record<string, React.FC> = {
    album: BodyContentWrapper,
    music: BodyContentWrapper,
};

const routes = [
    {
        key: "music",
        i18nKey: "common.singleMusic",
        title: "单曲",
    },
    {
        key: "album",
        i18nKey: "common.album",
        title: "专辑",
    },
];

export default function Body() {
    const [index, setIndex] = useState(0);
    const colors = useColors();
    const { t } = useI18N();

    return (
        <TabView
            // 翻到第一页、最后一页时的边缘回弹没结束，会吃掉下一次点击
            overScrollMode="never"
            lazy
            style={style.wrapper}
            navigationState={{
                index,
                routes,
            }}
            renderTabBar={props => {
                const options = props.navigationState.routes.reduce(
                    (acc, route) => {
                        const title = t(route.i18nKey as any) ?? route.title;
                        acc[route.key] = {
                            // 不给的话读的是路由的 title（写死的中文）
                            accessibilityLabel: title,
                            label: ({ focused }: any) => (
                                <TabLabel title={title} focused={focused} />
                            ),
                        };
                        return acc;
                    },
                    {} as Record<string, any>,
                );

                // 标签跟着系统字体变宽，窄屏、大字体时第二个标签可以滑过去
                return (
                    <TabBar
                        {...props}
                        scrollEnabled
                        style={style.transparentColor}
                        tabStyle={style.tab}
                        renderIndicator={() => null}
                        pressColor="transparent"
                        inactiveColor={colors.text}
                        activeColor={colors.primary}
                        options={options}
                    />
                );
            }}
            renderScene={SceneMap(sceneMap)}
            onIndexChange={setIndex}
            initialLayout={{ width: rpx(750) }}
        />
    );
}

export function BodyContentWrapper(props: any) {
    const tab: IArtist.ArtistMediaType = props.route.key;
    const queryResult = useAtomValue(queryResultAtom);

    const Component = content[tab];
    const renderItem = ({ item, index }: any) => (
        <Component item={item} index={index} />
    );

    return (
        <ResultList tab={tab} data={queryResult[tab]} renderItem={renderItem} />
    );
}

const style = StyleSheet.create({
    wrapper: {
        zIndex: 100,
    },
    transparentColor: {
        backgroundColor: "transparent",
        shadowColor: "transparent",
        borderColor: "transparent",
    },
    tab: {
        width: "auto",
    },
});

import React, { ReactNode, useRef } from "react";
import { View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import type {
    NavigationHelpers,
    ParamListBase,
    TabNavigationState,
} from "@react-navigation/native";
import { BlurTargetView } from "expo-blur";
import PageBackground from "@/components/base/pageBackground";
import globalStyle from "@/constants/globalStyle";
import HomeTabBar from "./tabBar";

export interface IHomeTabsLayoutProps {
    state: TabNavigationState<ParamListBase>;
    navigation: NavigationHelpers<ParamListBase>;
    children: ReactNode;
}

/**
 * 主页标签的外层（Tab.Navigator 的 layout）。标签栏要模糊标签页内容，就不能待在
 * 包着内容的 BlurTargetView 里（会把自己也录进模糊），所以不用 Tab.Navigator 的
 * tabBar，而是在这里放到 BlurTargetView 外面。
 */
export default function HomeTabsLayout(props: IHomeTabsLayoutProps) {
    const { state, navigation, children } = props;
    const blurTargetRef = useRef<View>(null);

    return (
        <View style={globalStyle.flex1}>
            <BlurTargetView ref={blurTargetRef} style={globalStyle.flex1}>
                {/* 首页标签是透明的，底色和自定义背景图要铺在 BlurTargetView 里，
                    标签栏才模糊得到它们，否则模糊出来是窗口的深色底 */}
                <PageBackground showCustomImage />
                {children}
            </BlurTargetView>
            <HomeTabBar
                state={state}
                // layout 的类型里没有标签栏事件，运行时它和 tabBar 拿到的是同一个
                // navigation 对象，可以 emit tabPress
                navigation={navigation as BottomTabBarProps["navigation"]}
                blurTarget={blurTargetRef}
            />
        </View>
    );
}

import React from "react";
import { StatusBar as NativeStatusBar, StyleSheet } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import NavBar from "./components/navBar";
import HomeTabsLayout, { IHomeTabsLayoutProps } from "./components/tabsLayout";
import StatusBar from "@/components/base/statusBar";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import globalStyle from "@/constants/globalStyle";
import Theme from "@/core/theme";
import { HOME_TAB } from "@/core/router";
import ClassicHomeBody from "./components/homeBody/classicHome";
import HomeOverview from "./components/homeBody/homeOverview";
import { useAppConfig } from "@/core/appConfig";
import { useMusicBarLayoutState } from "@/components/musicBar/layoutState";
import SearchPage from "@/pages/searchPage";
import Library from "@/pages/library";
import SettingsHome from "@/pages/settingsHome";

function HomeFeed() {
    const useEnhancedHome = useAppConfig("theme.useEnhancedHome") ?? true;
    const safeAreaInsets = useSafeAreaInsets();
    const topInset = Math.max(
        safeAreaInsets.top,
        NativeStatusBar.currentHeight ?? 0,
    );

    // 信息流首页自带大标题，整页交给它
    if (useEnhancedHome) {
        return <HomeOverview />;
    }

    return (
        <SafeAreaView
            edges={["bottom"]}
            style={[styles.appWrapper, { paddingTop: topInset }]}>
            <HomeStatusBar />
            <HorizontalSafeAreaView style={globalStyle.flex1}>
                <>
                    <NavBar />
                    <ClassicHomeBody />
                </>
            </HorizontalSafeAreaView>
        </SafeAreaView>
    );
}

function HomeStatusBar() {
    const theme = Theme.useTheme();

    return (
        <StatusBar
            backgroundColor="transparent"
            barStyle={theme.dark ? undefined : "dark-content"}
        />
    );
}

const Tab = createBottomTabNavigator();

// 标签栏由 HomeTabsLayout 渲染在模糊目标外面，见 components/tabsLayout
function renderHomeTabsLayout(props: IHomeTabsLayoutProps) {
    return <HomeTabsLayout {...props} />;
}

function renderNoTabBar() {
    return null;
}

/**
 * 主页：底部四个标签（首页、搜索、资料库、设置）。标签栏和迷你播放器都悬浮在
 * 内容上面，各标签页自己用 useMusicBarFloatingOffset 给底部留出空间。
 */
export default function Home() {
    const theme = Theme.useTheme();
    const { setActiveTab } = useMusicBarLayoutState();
    // 首页标签透出 HomeTabsLayout 铺的自定义背景图，其他标签用纯色底盖住它
    const opaqueScene = {
        backgroundColor: theme.colors.pageBackground,
    };

    return (
        <Tab.Navigator
            initialRouteName={HOME_TAB.HOME}
            backBehavior="firstRoute"
            layout={renderHomeTabsLayout}
            tabBar={renderNoTabBar}
            screenListeners={({ route }) => ({
                focus: () => {
                    setActiveTab(route.name);
                },
            })}
            screenOptions={{
                headerShown: false,
                sceneStyle: opaqueScene,
            }}>
            <Tab.Screen
                name={HOME_TAB.HOME}
                component={HomeFeed}
                options={{ sceneStyle: styles.transparentScene }}
            />
            <Tab.Screen name={HOME_TAB.SEARCH} component={SearchPage} />
            <Tab.Screen name={HOME_TAB.LIBRARY} component={Library} />
            <Tab.Screen name={HOME_TAB.SETTINGS} component={SettingsHome} />
        </Tab.Navigator>
    );
}

const styles = StyleSheet.create({
    appWrapper: {
        flexDirection: "column",
        flex: 1,
    },
    transparentScene: {
        backgroundColor: "transparent",
    },
});

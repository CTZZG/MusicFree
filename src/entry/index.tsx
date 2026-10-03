import React, {
    RefObject,
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { BlurTargetView } from "expo-blur";
import bootstrap from "./bootstrap/bootstrap";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Dialogs from "@/components/dialogs";
import Panels from "@/components/panels";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Debug from "@/components/debug";
import { PortalHost } from "@/components/base/portal";
import globalStyle from "@/constants/globalStyle";
import Theme from "@/core/theme";
import { BootstrapComponent } from "./bootstrap/BootstrapComponent";
import { ToastBaseComponent } from "@/components/base/toast";
import { StatusBar, StyleSheet, View } from "react-native";
import { ReduceMotion, ReducedMotionConfig } from "react-native-reanimated";
import { routes } from "@/core/router/routes.tsx";
import ErrorBoundary from "@/components/errorBoundary";
import { navigationRef, ROUTE_PATH } from "@/core/router";
import MusicBar from "@/components/musicBar";
import ScreenSurface from "@/components/base/screenSurface";
import {
    MusicBarLayoutProvider,
    useMusicBarLayoutState,
} from "@/components/musicBar/layoutState";

/**
 * 字体颜色
 */

StatusBar.setBackgroundColor("transparent");
StatusBar.setTranslucent(true);

bootstrap();
const Stack = createNativeStackNavigator<any>();

function MusicBarOverlay(props: { blurTarget: RefObject<View | null> }) {
    const { layout } = useMusicBarLayoutState();
    return (
        <View
            collapsable={false}
            pointerEvents={layout.visible ? "box-none" : "none"}
            style={styles.musicBarOverlay}>
            <MusicBar blurTarget={props.blurTarget} />
        </View>
    );
}

const surfacedRoutes = routes.map(route => {
    const RouteComponent = route.component;
    // 页面统一铺 iOS 的纯色底。首页的自定义背景图由主页自己铺在标签栏要模糊的
    // BlurTargetView 里（见 pages/home），这里不再重复铺
    function SurfacedRoute(screenProps: any) {
        return (
            <ScreenSurface>
                <RouteComponent {...screenProps} />
            </ScreenSurface>
        );
    }
    return { ...route, component: SurfacedRoute };
});

export default function Pages() {
    const theme = Theme.useTheme();
    const [currentRouteName, setCurrentRouteName] = useState<string>(
        routes[0].path,
    );
    // 导航一开始就更新的路由名。currentRouteName 要等 transitionEnd 才提交，
    // 那是为了让液态玻璃背板在转场结束后才采样（否则会抓到中间帧位图）；但
    // 播放条的显隐不能跟着一起等——否则进入播放详情页时，播放条会在整个转场
    // 动画期间继续压在底部，直到动画结束才消失。两个诉求分开各用一个状态。
    const [stagedRouteName, setStagedRouteName] = useState<string>(
        routes[0].path,
    );
    const [transitionInProgress, setTransitionInProgress] = useState(false);
    // 迷你播放器模糊的是整个根栈：它浮在这个 BlurTargetView 外面，页面都在里面
    const rootBlurTargetRef = useRef<View>(null);
    const pendingRouteNameRef = useRef(currentRouteName);
    const transitionFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const readCurrentRouteName = useCallback(() => {
        const rootState = navigationRef.getRootState();
        return rootState?.routes[rootState.index]?.name ?? routes[0].path;
    }, []);
    const commitCurrentRouteName = useCallback(() => {
        const routeName = readCurrentRouteName();
        pendingRouteNameRef.current = routeName;
        setStagedRouteName(routeName);
        setCurrentRouteName(routeName);
        setTransitionInProgress(false);
        if (transitionFallbackRef.current) {
            clearTimeout(transitionFallbackRef.current);
            transitionFallbackRef.current = null;
        }
    }, [readCurrentRouteName]);
    const stageCurrentRouteName = useCallback(() => {
        const routeName = readCurrentRouteName();
        if (routeName === pendingRouteNameRef.current) {
            return;
        }
        pendingRouteNameRef.current = routeName;
        // 立刻生效，播放条在导航一开始就按目标路由决定显隐。
        setStagedRouteName(routeName);
        setTransitionInProgress(true);
        if (transitionFallbackRef.current) {
            clearTimeout(transitionFallbackRef.current);
        }
        transitionFallbackRef.current = setTimeout(commitCurrentRouteName, 600);
    }, [commitCurrentRouteName, readCurrentRouteName]);

    useEffect(
        () => () => {
            if (transitionFallbackRef.current) {
                clearTimeout(transitionFallbackRef.current);
            }
        },
        [],
    );

    return (
        <>
            <BootstrapComponent />
            <ReducedMotionConfig mode={ReduceMotion.System} />
            <GestureHandlerRootView style={globalStyle.flex1}>
                <SafeAreaProvider>
                    <MusicBarLayoutProvider
                        routeName={currentRouteName}
                        visibilityRouteName={stagedRouteName}
                        transitionInProgress={transitionInProgress}>
                        <NavigationContainer
                            ref={navigationRef}
                            theme={theme}
                            onReady={commitCurrentRouteName}
                            onStateChange={stageCurrentRouteName}>
                            <ErrorBoundary>
                                <View style={globalStyle.flex1}>
                                    <BlurTargetView
                                        ref={rootBlurTargetRef}
                                        style={globalStyle.flex1}>
                                        {/* 这层底色只在转场那几帧可见：旧屏幕已经停止
                                            绘制、新屏幕还没滑到位时，中间的空隙会穿透到
                                            Android 的 windowBackground（#27282C，接近黑），
                                            看起来就是「切页面黑闪一下」。铺上主题页面背景
                                            后，空隙的颜色与页面一致，正常情况下这层永远被
                                            页面盖住。放在 BlurTargetView 里，迷你播放器
                                            模糊到的空隙也是页面底色。 */}
                                        <View
                                            style={[
                                                StyleSheet.absoluteFill,
                                                {
                                                    backgroundColor:
                                                        theme.colors
                                                            .pageBackground ??
                                                        theme.colors.background,
                                                },
                                            ]}
                                        />
                                        <Stack.Navigator
                                            initialRouteName={routes[0].path}
                                            screenOptions={{
                                                headerShown: false,
                                                animation: "slide_from_right",
                                                animationDuration: 100,
                                            }}
                                            screenListeners={{
                                                transitionEnd:
                                                    commitCurrentRouteName,
                                            }}>
                                            {surfacedRoutes.map(route => (
                                                <Stack.Screen
                                                    key={route.path}
                                                    name={route.path}
                                                    component={route.component}
                                                    options={
                                                        route.path ===
                                                        ROUTE_PATH.MUSIC_DETAIL
                                                            ? {
                                                                statusBarBackgroundColor:
                                                                      "transparent",
                                                                statusBarTranslucent:
                                                                      true,
                                                                // 和 iOS 一样从底部升起
                                                                animation:
                                                                      "slide_from_bottom",
                                                                animationDuration: 280,
                                                            }
                                                            : undefined
                                                    }
                                                />
                                            ))}
                                        </Stack.Navigator>
                                    </BlurTargetView>
                                    <MusicBarOverlay
                                        blurTarget={rootBlurTargetRef}
                                    />
                                    <Panels />
                                    <Dialogs />
                                    <Debug />
                                    <ToastBaseComponent />
                                    <PortalHost />
                                </View>
                            </ErrorBoundary>
                        </NavigationContainer>
                    </MusicBarLayoutProvider>
                </SafeAreaProvider>
            </GestureHandlerRootView>
        </>
    );
}

const styles = StyleSheet.create({
    musicBarOverlay: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 100,
        elevation: 8,
    },
});

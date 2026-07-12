import React, { useCallback, useEffect, useRef, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
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
import { navigationRef } from "@/core/router";
import MusicBar from "@/components/musicBar";
import ScreenSurface from "@/components/base/screenSurface";
import { MusicBarLayoutProvider } from "@/components/musicBar/layoutState";

/**
 * 字体颜色
 */

StatusBar.setBackgroundColor("transparent");
StatusBar.setTranslucent(true);

bootstrap();
const Stack = createNativeStackNavigator<any>();

const surfacedRoutes = routes.map(route => {
    const RouteComponent = route.component;
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
    const [currentRouteName, setCurrentRouteName] = useState<string>(routes[0].path);
    const [transitionInProgress, setTransitionInProgress] = useState(false);
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
        setTransitionInProgress(true);
        if (transitionFallbackRef.current) {
            clearTimeout(transitionFallbackRef.current);
        }
        transitionFallbackRef.current = setTimeout(
            commitCurrentRouteName,
            600,
        );
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
                        transitionInProgress={transitionInProgress}>
                        <NavigationContainer
                            ref={navigationRef}
                            theme={theme}
                            onReady={commitCurrentRouteName}
                            onStateChange={stageCurrentRouteName}>
                            <ErrorBoundary>
                                <View style={globalStyle.flex1}>
                                    <Stack.Navigator
                                        initialRouteName={routes[0].path}
                                        screenOptions={{
                                            headerShown: false,
                                            animation: "slide_from_right",
                                            animationDuration: 100,
                                        }}
                                        screenListeners={{
                                            transitionEnd: commitCurrentRouteName,
                                        }}>
                                        {surfacedRoutes.map(route => (
                                            <Stack.Screen
                                                key={route.path}
                                                name={route.path}
                                                component={route.component}
                                            />
                                        ))}
                                    </Stack.Navigator>
                                    <View
                                        collapsable={false}
                                        pointerEvents="box-none"
                                        style={styles.musicBarOverlay}>
                                        <MusicBar />
                                    </View>
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

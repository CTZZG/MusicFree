import React, { useEffect, useMemo, useRef } from "react";
import {
    BackHandler,
    Platform,
    StatusBar as NativeStatusBar,
    StyleSheet,
    useWindowDimensions,
} from "react-native";

import NavBar from "./components/navBar";
import {
    createDrawerNavigator,
    useDrawerStatus,
} from "@react-navigation/drawer";
import HomeDrawer from "./components/drawer";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import StatusBar from "@/components/base/statusBar";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import globalStyle from "@/constants/globalStyle";
import Theme from "@/core/theme";
import HomeBody from "./components/homeBody";
import HomeBodyHorizontal from "./components/homeBodyHorizontal";
import useOrientation from "@/hooks/useOrientation";
import { useMusicBarLayoutState } from "@/components/musicBar/layoutState";

const PORTRAIT_DRAWER_MAX_WIDTH = 420;
const LANDSCAPE_DRAWER_MAX_WIDTH = 440;
const DRAWER_MIN_WIDTH = 320;

function Home() {
    const orientation = useOrientation();
    const safeAreaInsets = useSafeAreaInsets();
    const topInset = Math.max(
        safeAreaInsets.top,
        NativeStatusBar.currentHeight ?? 0,
    );
    // 抽屉导航器没有 drawerOpen/drawerClose 事件，只能从 drawer status 同步，
    // 否则底部播放条在侧边栏打开时不会收起。
    const drawerStatus = useDrawerStatus();
    const { setDrawerOpen } = useMusicBarLayoutState();

    useEffect(() => {
        setDrawerOpen(drawerStatus === "open");
    }, [drawerStatus, setDrawerOpen]);

    return (
        <SafeAreaView
            edges={["bottom"]}
            style={[styles.appWrapper, { paddingTop: topInset }]}>
            <HomeStatusBar />
            <HorizontalSafeAreaView style={globalStyle.flex1}>
                <>
                    <NavBar />
                    {orientation === "vertical" ? (
                        <HomeBody />
                    ) : (
                        <HomeBodyHorizontal />
                    )}
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

// function Body() {
//     const orientation = useOrientation();
//     return (
//         <ScrollView
//             style={[
//                 styles.appWrapper,
//                 orientation === 'horizontal' ? styles.flexRow : null,
//             ]}>
//             <Operations orientation={orientation} />
//         </ScrollView>
//     );
// }

const LeftDrawer = createDrawerNavigator();
export default function App() {
    const orientation = useOrientation();
    const theme = Theme.useTheme();
    const { width } = useWindowDimensions();
    const { drawerOpen, setDrawerOpen } = useMusicBarLayoutState();
    const drawerNavigationRef = useRef<any>(null);
    const drawerWidth = useMemo(() => {
        const safeWindowWidth = Math.max(0, width);
        if (orientation === "horizontal") {
            const targetWidth = Math.max(
                DRAWER_MIN_WIDTH,
                Math.min(safeWindowWidth * 0.56, LANDSCAPE_DRAWER_MAX_WIDTH),
            );
            return Math.min(safeWindowWidth, targetWidth);
        }

        const targetWidth = Math.max(
            DRAWER_MIN_WIDTH,
            Math.min(safeWindowWidth * 0.82, PORTRAIT_DRAWER_MAX_WIDTH),
        );
        return Math.min(safeWindowWidth, targetWidth);
    }, [orientation, width]);

    useEffect(
        () => () => {
            setDrawerOpen(false);
        },
        [setDrawerOpen],
    );

    useEffect(() => {
        if (Platform.OS !== "android") {
            return;
        }
        const subscription = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                if (!drawerOpen) {
                    return false;
                }
                drawerNavigationRef.current?.closeDrawer?.();
                setDrawerOpen(false);
                return true;
            },
        );
        return () => subscription.remove();
    }, [drawerOpen, setDrawerOpen]);

    return (
        <LeftDrawer.Navigator
            screenListeners={({ navigation }) => {
                drawerNavigationRef.current = navigation;
                return {
                    // 手势拖开抽屉时导航状态要等手势结束才更新，这里在动画一开始
                    // 就先收起播放条，避免播放条压在抽屉上。
                    transitionStart: (event: {
                        data: { closing: boolean };
                    }) => {
                        if (!event.data.closing) {
                            setDrawerOpen(true);
                        }
                    },
                    transitionEnd: (event: {
                        data: { closing: boolean };
                    }) => {
                        setDrawerOpen(!event.data.closing);
                    },
                    blur: () => {
                        // The navigator event can outlive the render that
                        // created this listener. Always close the native
                        // drawer instead of trusting a potentially stale
                        // React state snapshot.
                        navigation.closeDrawer();
                        setDrawerOpen(false);
                    },
                };
            }}
            screenOptions={{
                headerShown: false,
                sceneStyle: {
                    backgroundColor: "transparent",
                },
                overlayStyle: {
                    backgroundColor: theme.colors.mask,
                },
                drawerStyle: {
                    width: drawerWidth,
                    backgroundColor: theme.colors.backdrop,
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                    elevation: 0,
                    shadowOpacity: 0,
                    shadowRadius: 0,
                },
            }}
            initialRouteName="HOME-MAIN"
            drawerContent={props => <HomeDrawer {...props} />}>
            <LeftDrawer.Screen name="HOME-MAIN" component={Home} />
        </LeftDrawer.Navigator>
    );
}

const styles = StyleSheet.create({
    appWrapper: {
        flexDirection: "column",
        flex: 1,
    },
    flexRow: {
        flexDirection: "row",
    },
});

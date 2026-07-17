import React, { useEffect, useMemo, useRef } from "react";
import {
    BackHandler,
    Platform,
    StatusBar as NativeStatusBar,
    StyleSheet,
    useWindowDimensions,
} from "react-native";

import NavBar from "./components/navBar";
import { createDrawerNavigator } from "@react-navigation/drawer";
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
                    drawerOpen: () => {
                        setDrawerOpen(true);
                    },
                    drawerClose: () => {
                        setDrawerOpen(false);
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

import React, { useMemo } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";

import NavBar from "./components/navBar";
import MusicBar from "@/components/musicBar";
import { createDrawerNavigator } from "@react-navigation/drawer";
import HomeDrawer from "./components/drawer";
import { SafeAreaView } from "react-native-safe-area-context";
import StatusBar from "@/components/base/statusBar";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import globalStyle from "@/constants/globalStyle";
import Theme from "@/core/theme";
import HomeBody from "./components/homeBody";
import HomeBodyHorizontal from "./components/homeBodyHorizontal";
import useOrientation from "@/hooks/useOrientation";

const PORTRAIT_DRAWER_MAX_WIDTH = 420;
const LANDSCAPE_DRAWER_MAX_WIDTH = 440;
const DRAWER_MIN_WIDTH = 320;

function Home() {
    const orientation = useOrientation();

    return (
        <SafeAreaView edges={["top", "bottom"]} style={styles.appWrapper}>
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
            <MusicBar />
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
    const { width } = useWindowDimensions();
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

    return (
        <LeftDrawer.Navigator
            screenOptions={{
                headerShown: false,
                drawerStyle: {
                    width: drawerWidth,
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

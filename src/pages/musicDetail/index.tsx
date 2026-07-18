import StatusBar from "@/components/base/statusBar";
import globalStyle from "@/constants/globalStyle";
import useOrientation from "@/hooks/useOrientation";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import Background from "./components/background";
import Bottom from "./components/bottom";
import Content from "./components/content";
import Lyric from "./components/content/lyric";
import NavBar from "./components/navBar";
import Config, { useAppConfig } from "@/core/appConfig";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { MusicDetailArtworkProvider } from "./artworkContext";
import rpx from "@/utils/rpx";

export default function MusicDetail() {
    const orientation = useOrientation();
    const immersiveMode =
        useAppConfig("basic.musicDetailImmersiveMode") ?? false;
    const coverStyle = useAppConfig("theme.coverStyle") ?? "square";
    const [tab, setTab] = useState<"album" | "lyric">(
        Config.getConfig("basic.musicDetailDefault") || "album",
    );
    const useHeroLayout = orientation === "vertical" && coverStyle !== "circle";
    const showOverlayNav = immersiveMode || (useHeroLayout && tab === "album");
    const swipeProgress = useSharedValue(0);
    const pageSwipeLift = rpx(72);
    const backgroundSwipeLift = rpx(36);

    const pageSwipeAnimatedStyle = useAnimatedStyle(() => {
        const progress = Math.max(0, swipeProgress.value);
        return {
            opacity: 1 - Math.min(1.8, progress) * 0.055,
            transform: [{ translateY: -progress * pageSwipeLift }],
        };
    }, [pageSwipeLift]);
    const backgroundSwipeAnimatedStyle = useAnimatedStyle(() => {
        const progress = Math.min(1.8, Math.max(0, swipeProgress.value));
        return {
            transform: [
                { scale: 1 + progress * 0.045 },
                { translateY: -progress * backgroundSwipeLift },
            ],
        };
    }, [backgroundSwipeLift]);

    useEffect(() => {
        const needAwake = Config.getConfig("basic.musicDetailAwake");
        if (needAwake) {
            activateKeepAwakeAsync();
        }
        return () => {
            if (needAwake) {
                deactivateKeepAwake();
            }
        };
    }, []);

    return (
        <MusicDetailArtworkProvider>
            <View style={style.root}>
                <Animated.View
                    pointerEvents="none"
                    style={[
                        style.backgroundLayer,
                        backgroundSwipeAnimatedStyle,
                    ]}>
                    <Background tab={tab} useHeroLayout={useHeroLayout} />
                </Animated.View>
                <SafeAreaView
                    edges={
                        immersiveMode ? ["left", "right", "bottom"] : undefined
                    }
                    style={globalStyle.fwflex1}>
                    <StatusBar
                        hidden={immersiveMode}
                        backgroundColor={"transparent"}
                        barStyle="light-content"
                        translucent
                    />
                    <Animated.View
                        style={[style.bodyWrapper, pageSwipeAnimatedStyle]}>
                        <View style={globalStyle.flex1}>
                            {showOverlayNav ? null : (
                                <NavBar
                                    onTitlePress={
                                        tab === "lyric"
                                            ? () => setTab("album")
                                            : undefined
                                    }
                                />
                            )}
                            <Content
                                immersiveMode={immersiveMode}
                                tab={tab}
                                onTabChange={setTab}
                            />
                            <Bottom swipeProgress={swipeProgress} />
                            {showOverlayNav ? (
                                <View
                                    pointerEvents="box-none"
                                    style={style.navOverlay}>
                                    <NavBar compact />
                                </View>
                            ) : null}
                        </View>
                        {orientation === "horizontal" ? (
                            <View style={globalStyle.flex1}>
                                <Lyric immersiveMode={immersiveMode} />
                            </View>
                        ) : null}
                    </Animated.View>
                </SafeAreaView>
            </View>
        </MusicDetailArtworkProvider>
    );
}

const style = StyleSheet.create({
    root: {
        width: "100%",
        flex: 1,
        overflow: "hidden",
        backgroundColor: "black",
    },
    backgroundLayer: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    },
    bodyWrapper: {
        width: "100%",
        flex: 1,
        flexDirection: "row",
    },
    navOverlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        elevation: 10,
    },
});

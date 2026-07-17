import StatusBar from "@/components/base/statusBar";
import globalStyle from "@/constants/globalStyle";
import useOrientation from "@/hooks/useOrientation";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Background from "./components/background";
import Bottom from "./components/bottom";
import Content from "./components/content";
import Lyric from "./components/content/lyric";
import NavBar from "./components/navBar";
import Config, { useAppConfig } from "@/core/appConfig";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { MusicDetailArtworkProvider } from "./artworkContext";

export default function MusicDetail() {
    const orientation = useOrientation();
    const immersiveMode = useAppConfig("basic.musicDetailImmersiveMode") ?? false;
    const coverStyle = useAppConfig("theme.coverStyle") ?? "square";
    const [tab, setTab] = useState<"album" | "lyric">(
        Config.getConfig("basic.musicDetailDefault") || "album",
    );
    const useHeroLayout =
        orientation === "vertical" && coverStyle !== "circle";
    const showOverlayNav =
        immersiveMode || (useHeroLayout && tab === "album");

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
            <Background tab={tab} useHeroLayout={useHeroLayout} />
            <SafeAreaView
                edges={immersiveMode ? ["left", "right", "bottom"] : undefined}
                style={globalStyle.fwflex1}>
                <StatusBar
                    hidden={immersiveMode}
                    backgroundColor={"transparent"}
                    barStyle="light-content"
                />
                <View style={style.bodyWrapper}>
                    <View style={globalStyle.flex1}>
                        {showOverlayNav ? null : <NavBar />}
                        <Content
                            immersiveMode={immersiveMode}
                            tab={tab}
                            onTabChange={setTab}
                        />
                        <Bottom />
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
                </View>
            </SafeAreaView>
        </MusicDetailArtworkProvider>
    );
}

const style = StyleSheet.create({
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

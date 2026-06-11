import StatusBar from "@/components/base/statusBar";
import globalStyle from "@/constants/globalStyle";
import useOrientation from "@/hooks/useOrientation";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Background from "./components/background";
import Bottom from "./components/bottom";
import Content from "./components/content";
import Lyric from "./components/content/lyric";
import NavBar from "./components/navBar";
import Config, { useAppConfig } from "@/core/appConfig";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

export default function MusicDetail() {
    const orientation = useOrientation();
    const immersiveMode = useAppConfig("basic.musicDetailImmersiveMode") ?? false;

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
        <>
            <Background />
            <SafeAreaView
                edges={immersiveMode ? ["left", "right", "bottom"] : undefined}
                style={globalStyle.fwflex1}>
                <StatusBar
                    hidden={immersiveMode}
                    backgroundColor={"transparent"}
                />
                <View style={style.bodyWrapper}>
                    <View style={globalStyle.flex1}>
                        {immersiveMode ? null : <NavBar />}
                        <Content immersiveMode={immersiveMode} />
                        <Bottom />
                    </View>
                    {orientation === "horizontal" ? (
                        <View style={globalStyle.flex1}>
                            <Lyric immersiveMode={immersiveMode} />
                        </View>
                    ) : null}
                </View>
            </SafeAreaView>
        </>
    );
}

const style = StyleSheet.create({
    bodyWrapper: {
        width: "100%",
        flex: 1,
        flexDirection: "row",
    },
});

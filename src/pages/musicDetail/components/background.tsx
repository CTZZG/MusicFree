import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import LinearGradient from "react-native-linear-gradient";
import { useMusicDetailArtwork } from "../artworkContext";

export default function Background() {
    const artwork = useMusicDetailArtwork();

    const artworkSource = useMemo(() => {
        if (typeof artwork === "string") {
            return {
                uri: artwork,
            };
        }
        return artwork;
    }, [artwork]);

    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={style.background} />
            <Image
                style={style.blur}
                blurRadius={42}
                contentFit="cover"
                transition={260}
                source={artworkSource}
            />
            <LinearGradient
                colors={[
                    "rgba(0,0,0,0.08)",
                    "rgba(0,0,0,0.3)",
                    "rgba(0,0,0,0.72)",
                ]}
                locations={[0, 0.48, 1]}
                style={StyleSheet.absoluteFill}
            />
        </View>
    );
}

const style = StyleSheet.create({
    background: {
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "#000",
    },
    blur: {
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        opacity: 0.72,
        transform: [{ scale: 1.08 }],
    },
});

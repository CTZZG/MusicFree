import React, { useMemo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import LinearGradient from "react-native-linear-gradient";
import { useMusicDetailVisuals } from "../artworkContext";

interface IBackgroundProps {
    tab: "album" | "lyric";
    useHeroLayout: boolean;
}

export default function Background(props: IBackgroundProps) {
    const { tab, useHeroLayout } = props;
    const { heroArtwork, hasHeroArtwork } = useMusicDetailVisuals();
    const { height, width } = useWindowDimensions();
    const showHero = tab === "album" && useHeroLayout;
    const viewportHeight = Math.max(1, height);
    const heroHeight = Math.min(viewportHeight * 0.58, width * 1.18);
    const heroFadeStart = Math.max(0, heroHeight * 0.76);
    const heroFadeEnd = Math.min(
        viewportHeight * 0.84,
        heroHeight + viewportHeight * 0.18,
    );
    const heroGradientLocations = [
        0,
        heroFadeStart / viewportHeight,
        heroHeight / viewportHeight,
        heroFadeEnd / viewportHeight,
        1,
    ];

    const artworkSource = useMemo(
        () => (heroArtwork ? { uri: heroArtwork } : undefined),
        [heroArtwork],
    );

    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={style.background} />
            {hasHeroArtwork ? (
                <Image
                    style={style.blur}
                    blurRadius={showHero ? 34 : 46}
                    contentFit="cover"
                    transition={220}
                    source={artworkSource}
                />
            ) : null}
            {showHero && hasHeroArtwork ? (
                <Image
                    style={[style.hero, { height: heroFadeEnd }]}
                    contentFit="cover"
                    contentPosition="center"
                    transition={240}
                    source={artworkSource}
                />
            ) : null}
            <LinearGradient
                colors={
                    showHero
                        ? [
                            "rgba(0,0,0,0.06)",
                            "rgba(7,9,12,0.08)",
                            "rgba(10,12,16,0.24)",
                            "rgba(10,12,16,0.86)",
                            "rgba(10,12,16,0.96)",
                        ]
                        : [
                            "rgba(0,0,0,0.16)",
                            "rgba(0,0,0,0.4)",
                            "rgba(0,0,0,0.78)",
                        ]
                }
                locations={showHero ? heroGradientLocations : [0, 0.5, 1]}
                style={StyleSheet.absoluteFill}
            />
        </View>
    );
}

const style = StyleSheet.create({
    background: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: "#0a0c10",
    },
    blur: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        opacity: 0.58,
        transform: [{ scale: 1.08 }],
    },
    hero: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        width: "100%",
    },
});

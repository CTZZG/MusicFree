import MaskedView from "@react-native-masked-view/masked-view";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import LinearGradient from "react-native-linear-gradient";
import ImageColors from "react-native-image-colors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fontWeightConst } from "@/constants/uiConst";
import { useCurrentMusic } from "@/core/trackPlayer";
import rpx from "@/utils/rpx";
import { useMusicDetailVisuals } from "../artworkContext";
import { getMusicDetailHeroLayout } from "../heroLayout";
import {
    ambientColorWithAlpha,
    createArtworkColorCacheKey,
    DEFAULT_IMMERSIVE_AMBIENT_COLOR,
    resolveImmersiveAmbientColor,
} from "../immersiveBackgroundPalette";

interface IBackgroundProps {
    tab: "album" | "lyric";
    useHeroLayout: boolean;
}

interface IAmbientColorState {
    artwork?: string;
    color: string;
}

function useArtworkAmbientColor(artwork?: string) {
    const [state, setState] = useState<IAmbientColorState>({
        color: DEFAULT_IMMERSIVE_AMBIENT_COLOR,
    });

    useEffect(() => {
        if (!artwork) {
            setState({ color: DEFAULT_IMMERSIVE_AMBIENT_COLOR });
            return;
        }

        let active = true;
        setState({
            artwork,
            color: DEFAULT_IMMERSIVE_AMBIENT_COLOR,
        });
        ImageColors.getColors(artwork, {
            fallback: DEFAULT_IMMERSIVE_AMBIENT_COLOR,
            cache: true,
            key: createArtworkColorCacheKey(artwork),
            pixelSpacing: 5,
            quality: "low",
        })
            .then(result => {
                if (active) {
                    setState({
                        artwork,
                        color: resolveImmersiveAmbientColor(result),
                    });
                }
            })
            .catch(() => {
                if (active) {
                    setState({
                        artwork,
                        color: DEFAULT_IMMERSIVE_AMBIENT_COLOR,
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [artwork]);

    return state.artwork === artwork
        ? state.color
        : DEFAULT_IMMERSIVE_AMBIENT_COLOR;
}

export default function Background(props: IBackgroundProps) {
    const { tab, useHeroLayout } = props;
    const musicItem = useCurrentMusic();
    const { ambientArtwork, coverArtwork, musicKey } = useMusicDetailVisuals();
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const safeAreaInsets = useSafeAreaInsets();
    const showHero = tab === "album" && useHeroLayout;
    const ambientColor = useArtworkAmbientColor(ambientArtwork);
    const heroLayout = useMemo(
        () =>
            getMusicDetailHeroLayout({
                windowWidth,
                windowHeight,
                safeAreaTop: safeAreaInsets.top,
                safeAreaBottom: safeAreaInsets.bottom,
            }),
        [safeAreaInsets.bottom, safeAreaInsets.top, windowHeight, windowWidth],
    );
    const ambientSource = useMemo(
        () => (ambientArtwork ? { uri: ambientArtwork } : undefined),
        [ambientArtwork],
    );
    const coverSource = useMemo(
        () => (coverArtwork ? { uri: coverArtwork } : undefined),
        [coverArtwork],
    );
    const heroSource = coverSource ?? ambientSource;
    const visualKey = `${musicKey ?? "none"}:${
        coverArtwork ?? ambientArtwork ?? "generated"
    }`;
    const ambientScale = 1.24;
    const heroStageHeight = heroLayout.top + heroLayout.imageHeight;
    const sharpMaskLocations = [
        0,
        Math.max(0, (heroLayout.top - rpx(56)) / heroStageHeight),
        Math.min(1, (heroLayout.top + rpx(44)) / heroStageHeight),
        (heroLayout.top + heroLayout.imageHeight * 0.5) / heroStageHeight,
        (heroLayout.top + heroLayout.imageHeight * 0.63) / heroStageHeight,
        (heroLayout.top + heroLayout.imageHeight * 0.82) / heroStageHeight,
        1,
    ];
    const tintLocations = [
        0,
        (heroLayout.top + heroLayout.imageHeight * 0.46) / heroStageHeight,
        (heroLayout.top + heroLayout.imageHeight * 0.62) / heroStageHeight,
        (heroLayout.top + heroLayout.imageHeight * 0.82) / heroStageHeight,
        1,
    ];

    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View
                style={[styles.background, { backgroundColor: ambientColor }]}
            />

            {ambientSource ? (
                <Image
                    key={`ambient-${visualKey}`}
                    style={[
                        styles.fullArtwork,
                        {
                            opacity: showHero ? 0.78 : 0.66,
                            transform: [{ scale: ambientScale }],
                        },
                    ]}
                    blurRadius={showHero ? 66 : 54}
                    contentFit="cover"
                    contentPosition="center"
                    recyclingKey={`ambient-${visualKey}`}
                    transition={360}
                    source={ambientSource}
                />
            ) : null}

            <LinearGradient
                colors={
                    showHero
                        ? [
                            ambientColorWithAlpha(ambientColor, 0.08),
                            ambientColorWithAlpha(ambientColor, 0.12),
                            ambientColorWithAlpha(ambientColor, 0.42),
                            ambientColorWithAlpha(ambientColor, 0.78),
                        ]
                        : [
                            ambientColorWithAlpha(ambientColor, 0.18),
                            ambientColorWithAlpha(ambientColor, 0.38),
                            ambientColorWithAlpha(ambientColor, 0.74),
                        ]
                }
                locations={showHero ? [0, 0.36, 0.7, 1] : [0, 0.52, 1]}
                style={StyleSheet.absoluteFill}
            />

            {showHero && heroSource ? (
                <View
                    style={[
                        styles.heroBlendViewport,
                        { top: 0, height: heroStageHeight },
                    ]}>
                    <Image
                        key={`hero-blur-${visualKey}`}
                        style={[
                            styles.heroBlurredArtwork,
                            { transform: [{ scale: 1.08 }] },
                        ]}
                        blurRadius={56}
                        contentFit="cover"
                        contentPosition="center"
                        recyclingKey={`hero-blur-${visualKey}`}
                        transition={360}
                        source={heroSource}
                    />

                    {coverSource ? (
                        <MaskedView
                            androidRenderingMode="hardware"
                            style={StyleSheet.absoluteFill}
                            maskElement={
                                <LinearGradient
                                    colors={[
                                        "rgba(0,0,0,0)",
                                        "rgba(0,0,0,0)",
                                        "rgba(0,0,0,1)",
                                        "rgba(0,0,0,1)",
                                        "rgba(0,0,0,0.9)",
                                        "rgba(0,0,0,0.36)",
                                        "rgba(0,0,0,0)",
                                    ]}
                                    locations={sharpMaskLocations}
                                    style={StyleSheet.absoluteFill}
                                />
                            }>
                            <Image
                                key={`hero-sharp-${visualKey}`}
                                style={styles.heroSharpArtwork}
                                contentFit="cover"
                                contentPosition="center"
                                recyclingKey={`hero-sharp-${visualKey}`}
                                transition={360}
                                source={coverSource}
                            />
                        </MaskedView>
                    ) : null}

                    <LinearGradient
                        colors={[
                            ambientColorWithAlpha(ambientColor, 0),
                            ambientColorWithAlpha(ambientColor, 0),
                            ambientColorWithAlpha(ambientColor, 0.14),
                            ambientColorWithAlpha(ambientColor, 0.54),
                            ambientColorWithAlpha(ambientColor, 1),
                        ]}
                        locations={tintLocations}
                        style={StyleSheet.absoluteFill}
                    />
                </View>
            ) : null}

            {showHero ? (
                <LinearGradient
                    colors={[
                        ambientColorWithAlpha(ambientColor, 0),
                        ambientColorWithAlpha(ambientColor, 0.48),
                        ambientColorWithAlpha(ambientColor, 0.96),
                        ambientColorWithAlpha(ambientColor, 1),
                    ]}
                    locations={[0, 0.18, 0.34, 1]}
                    style={[
                        styles.heroTailBlend,
                        { top: heroLayout.focusBottom - rpx(120) },
                    ]}
                />
            ) : null}

            {showHero && !coverSource ? (
                <View
                    style={[
                        styles.generatedCoverContent,
                        {
                            top: heroLayout.top + rpx(72),
                            height: heroLayout.focusHeight * 0.68,
                        },
                    ]}>
                    <Text style={styles.generatedCoverMark}>♫</Text>
                    <Text numberOfLines={2} style={styles.generatedCoverTitle}>
                        {musicItem?.title || "未知歌曲"}
                    </Text>
                    <Text numberOfLines={1} style={styles.generatedCoverArtist}>
                        {musicItem?.artist || "未知歌手"}
                    </Text>
                </View>
            ) : null}

            {showHero ? (
                <>
                    <LinearGradient
                        colors={[
                            "rgba(0,0,0,0.32)",
                            "rgba(0,0,0,0.08)",
                            "rgba(0,0,0,0)",
                        ]}
                        locations={[0, 0.72, 1]}
                        style={[styles.topShade, { height: heroLayout.top }]}
                    />
                    <LinearGradient
                        colors={[
                            "rgba(0,0,0,0)",
                            "rgba(0,0,0,0.08)",
                            "rgba(0,0,0,0.28)",
                        ]}
                        locations={[0, 0.6, 1]}
                        style={StyleSheet.absoluteFill}
                    />
                </>
            ) : (
                <LinearGradient
                    colors={[
                        "rgba(0,0,0,0.18)",
                        "rgba(0,0,0,0.3)",
                        "rgba(0,0,0,0.58)",
                    ]}
                    locations={[0, 0.48, 1]}
                    style={StyleSheet.absoluteFill}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    background: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    },
    fullArtwork: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    },
    heroBlendViewport: {
        position: "absolute",
        right: 0,
        left: 0,
        overflow: "hidden",
    },
    heroBlurredArtwork: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
    },
    heroSharpArtwork: {
        width: "100%",
        height: "100%",
    },
    generatedCoverContent: {
        position: "absolute",
        right: rpx(64),
        left: rpx(64),
        alignItems: "center",
        justifyContent: "center",
    },
    heroTailBlend: {
        position: "absolute",
        right: 0,
        bottom: 0,
        left: 0,
    },
    generatedCoverMark: {
        color: "rgba(255,255,255,0.9)",
        fontSize: rpx(82),
        lineHeight: rpx(96),
        marginBottom: rpx(24),
        textShadowColor: "rgba(0,0,0,0.28)",
        textShadowOffset: { width: 0, height: rpx(3) },
        textShadowRadius: rpx(8),
    },
    generatedCoverTitle: {
        color: "white",
        fontSize: rpx(42),
        lineHeight: rpx(54),
        fontWeight: fontWeightConst.bold,
        textAlign: "center",
        includeFontPadding: false,
        textShadowColor: "rgba(0,0,0,0.32)",
        textShadowOffset: { width: 0, height: rpx(2) },
        textShadowRadius: rpx(6),
    },
    generatedCoverArtist: {
        color: "rgba(255,255,255,0.74)",
        fontSize: rpx(24),
        lineHeight: rpx(36),
        marginTop: rpx(18),
        textAlign: "center",
        includeFontPadding: false,
    },
    topShade: {
        position: "absolute",
        top: 0,
        right: 0,
        left: 0,
    },
});

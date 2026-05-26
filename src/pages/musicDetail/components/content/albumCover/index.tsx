import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import rpx from "@/utils/rpx";
import { ImgAsset } from "@/constants/assetsConst";
import FastImage from "@/components/base/fastImage";
import useOrientation from "@/hooks/useOrientation";
import { useCurrentMusic } from "@/core/trackPlayer";
import globalStyle from "@/constants/globalStyle";
import { Pressable, useWindowDimensions, View } from "react-native";
import Operations from "./operations";
import { showPanel } from "@/components/panels/usePanel.ts";
import SongInfo from "./songInfo";
import MiniLyric from "./miniLyric";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const COVER_SIZE = rpx(500);
export const COVER_MARGIN = (rpx(750) - COVER_SIZE) / 2;

export function getCoverLeftMargin() {
    return COVER_MARGIN;
}

interface IProps {
    onTurnPageClick?: () => void;
}

export default function AlbumCover(props: IProps) {
    const { onTurnPageClick } = props;

    const musicItem = useCurrentMusic();
    const orientation = useOrientation();
    const { height: windowHeight, width: windowWidth } = useWindowDimensions();
    const safeAreaInsets = useSafeAreaInsets();
    const longPressTriggeredRef = useRef(false);
    const [containerHeight, setContainerHeight] = useState<number | null>(null);
    const [operationsBottom, setOperationsBottom] = useState<number | null>(null);

    const usableWindowHeight =
        windowHeight - safeAreaInsets.top - safeAreaInsets.bottom;
    const usableAspectRatio = usableWindowHeight / Math.max(1, windowWidth);
    const baseMiniLyricLayout = useMemo(() => {
        if (orientation !== "vertical") {
            return "normal" as const;
        }
        return usableAspectRatio < 1.9 ? ("compact" as const) : ("normal" as const);
    }, [orientation, usableAspectRatio]);
    const [miniLyricLayout, setMiniLyricLayout] = useState<
        "normal" | "compact" | "hidden"
    >(baseMiniLyricLayout);

    useEffect(() => {
        setMiniLyricLayout(baseMiniLyricLayout);
        setOperationsBottom(null);
    }, [baseMiniLyricLayout, windowHeight, windowWidth]);

    useEffect(() => {
        if (
            orientation !== "vertical" ||
            containerHeight === null ||
            operationsBottom === null
        ) {
            return;
        }
        if (operationsBottom > containerHeight + rpx(2)) {
            setOperationsBottom(null);
            setMiniLyricLayout(current => {
                if (current === "normal") {
                    return "compact";
                }
                return "hidden";
            });
        }
    }, [containerHeight, operationsBottom, orientation]);

    const artworkStyle = useMemo(() => {
        if (orientation === "vertical") {
            return {
                width: rpx(500),
                height: rpx(500),
            };
        } else {
            return {
                width: rpx(260),
                height: rpx(260),
            };
        }
    }, [orientation]);

    const handlePress = useCallback(() => {
        if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false;
            return;
        }
        onTurnPageClick?.();
    }, [onTurnPageClick]);

    const handleLongPress = useCallback(() => {
        longPressTriggeredRef.current = true;
        const artwork = musicItem?.artwork;
        if (typeof artwork === "string" && artwork.trim().length > 0) {
            showPanel("ImageViewer", {
                url: artwork,
            });
        }
    }, [musicItem?.artwork]);

    if (orientation === "horizontal") {
        return (
            <View style={styles.horizontalRoot}>
                <Pressable
                    delayLongPress={500}
                    onPress={handlePress}
                    onLongPress={handleLongPress}
                    style={styles.horizontalCoverArea}>
                    <View style={globalStyle.fullCenter}>
                        <FastImage
                            style={artworkStyle}
                            source={musicItem?.artwork}
                            placeholderSource={ImgAsset.albumDefault}
                        />
                    </View>
                </Pressable>
                <Operations />
            </View>
        );
    }

    return (
        <View
            style={styles.verticalRoot}
            onLayout={event => {
                setContainerHeight(event.nativeEvent.layout.height);
            }}>
            <Pressable
                delayLongPress={500}
                onPress={handlePress}
                onLongPress={handleLongPress}
                style={styles.coverArea}>
                <View style={styles.coverCenter}>
                    <FastImage
                        style={artworkStyle}
                        source={musicItem?.artwork}
                        placeholderSource={ImgAsset.albumDefault}
                    />
                </View>
            </Pressable>
            <SongInfo />
            {miniLyricLayout === "hidden" ? null : (
                <MiniLyric
                    compact={miniLyricLayout === "compact"}
                    onPress={onTurnPageClick}
                />
            )}
            <View style={globalStyle.flex1} />
            <View
                onLayout={event => {
                    const layout = event.nativeEvent.layout;
                    setOperationsBottom(layout.y + layout.height);
                }}>
                <Operations />
            </View>
        </View>
    );
}

const styles = {
    verticalRoot: {
        width: "100%" as const,
        flex: 1,
    },
    coverArea: {
        width: "100%" as const,
        flex: 1,
        minHeight: rpx(360),
        justifyContent: "center" as const,
    },
    coverCenter: {
        width: "100%" as const,
        justifyContent: "center" as const,
        alignItems: "center" as const,
    },
    horizontalRoot: {
        width: "100%" as const,
        flex: 1,
        justifyContent: "center" as const,
    },
    horizontalCoverArea: {
        width: "100%" as const,
        flex: 1,
        justifyContent: "center" as const,
    },
};

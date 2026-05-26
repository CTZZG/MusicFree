import React, { useCallback, useMemo, useRef } from "react";
import rpx from "@/utils/rpx";
import { ImgAsset } from "@/constants/assetsConst";
import FastImage from "@/components/base/fastImage";
import useOrientation from "@/hooks/useOrientation";
import { useCurrentMusic } from "@/core/trackPlayer";
import globalStyle from "@/constants/globalStyle";
import { Pressable, View } from "react-native";
import Operations from "./operations";
import { showPanel } from "@/components/panels/usePanel.ts";

interface IProps {
    onTurnPageClick?: () => void;
}

export default function AlbumCover(props: IProps) {
    const { onTurnPageClick } = props;

    const musicItem = useCurrentMusic();
    const orientation = useOrientation();
    const longPressTriggeredRef = useRef(false);

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

    return (
        <>
            <Pressable
                delayLongPress={500}
                onPress={handlePress}
                onLongPress={handleLongPress}>
                <View style={globalStyle.fullCenter}>
                    <FastImage
                        style={artworkStyle}
                        source={musicItem?.artwork}
                        placeholderSource={ImgAsset.albumDefault}
                    />
                </View>
            </Pressable>
            <Operations />
        </>
    );
}

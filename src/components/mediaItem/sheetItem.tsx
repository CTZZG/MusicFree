import React from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import ImageBtn from "../base/imageBtn";
import { useShortcutCardStyle } from "../base/shortcutPageSurface";

interface ISheetItemProps {
    pluginHash: string;
    sheetInfo: IMusic.IMusicSheetItemBase;
    presentation?: "plain" | "cards";
}

const marginBottom = rpx(16);

export default function SheetItem(props: ISheetItemProps) {
    const { sheetInfo, pluginHash, presentation = "plain" } = props ?? {};
    const navigate = useNavigate();
    const cardStyle = useShortcutCardStyle({ compact: true });
    return (
        <View
            style={[
                presentation === "cards" ? cardStyle : null,
                style.imageWrapper,
                presentation === "cards" ? style.cardWrapper : null,
            ]}>
            <ImageBtn
                style={{
                    marginBottom,
                }}
                uri={sheetInfo?.artwork ?? sheetInfo?.coverImg}
                title={sheetInfo?.title}
                onPress={() => {
                    navigate(ROUTE_PATH.PLUGIN_SHEET_DETAIL, {
                        pluginHash,
                        sheetInfo,
                    });
                }}
            />
        </View>
    );
}
const style = StyleSheet.create({
    imageWrapper: {
        width: "100%",
        justifyContent: "center",
        alignItems: "center",
    },
    cardWrapper: {
        width: "auto",
        alignSelf: "stretch",
        paddingHorizontal: rpx(10),
        paddingTop: rpx(10),
        paddingBottom: rpx(4),
    },
});

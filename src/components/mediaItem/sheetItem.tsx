import React from "react";
import { Pressable, StyleSheet } from "react-native";
import FastImage from "../base/fastImage";
import ThemeText from "../base/themeText";
import { ImgAsset } from "@/constants/assetsConst";
import { useI18N } from "@/core/i18n";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import useColors from "@/hooks/useColors";
import { PAGE_MARGIN, TILE_GAP } from "@/utils/tileLayout";

interface ISheetItemProps {
    pluginHash: string;
    sheetInfo: IMusic.IMusicSheetItemBase;
}

// 相邻两格封面之间的距离：每格左右各让一半，列表两侧再补到页边距
const GRID_GUTTER = TILE_GAP;

/** 歌单网格（推荐歌单、搜索结果的歌单页）列表两侧的内边距 */
export const SHEET_GRID_SIDE_PADDING = PAGE_MARGIN - GRID_GUTTER / 2;

/**
 * 歌单网格里的一格：封面铺满列宽并保持正方形，标题在下面最多两行，样式与
 * 首页「推荐歌单」横排一致，不再套卡片。
 *
 * 以前格子里放的是固定 210rpx 宽的图片按钮，再套一层左右各留 16 的卡片，三列时
 * 内容比卡片宽，两边都被裁掉：标题第一个字缺一半，卡片的圆角和底色从图片上方
 * 露出来。现在尺寸全部跟着列宽走，列数、屏幕宽度变了也不会超出格子。
 */
export default function SheetItem(props: ISheetItemProps) {
    const { sheetInfo, pluginHash } = props;
    const navigate = useNavigate();
    const colors = useColors();
    const { t } = useI18N();
    const title = sheetInfo?.title || t("common.unknownName");

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={title}
            onPress={() => {
                navigate(ROUTE_PATH.PLUGIN_SHEET_DETAIL, {
                    pluginHash,
                    sheetInfo,
                });
            }}
            style={({ pressed }) => [
                styles.tile,
                pressed ? styles.pressed : null,
            ]}>
            <FastImage
                style={[styles.cover, { backgroundColor: colors.placeholder }]}
                source={sheetInfo?.artwork ?? sheetInfo?.coverImg}
                placeholderSource={ImgAsset.albumDefault}
            />
            <ThemeText
                numberOfLines={2}
                fontSize="subTitle"
                fontWeight="medium"
                style={styles.title}>
                {title}
            </ThemeText>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    tile: {
        marginHorizontal: GRID_GUTTER / 2,
        marginBottom: 18,
    },
    pressed: {
        opacity: 0.6,
    },
    cover: {
        width: "100%",
        aspectRatio: 1,
        borderRadius: 12,
    },
    title: {
        marginTop: 8,
    },
});

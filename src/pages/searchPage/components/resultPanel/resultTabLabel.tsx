import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Color from "color";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import type { ITabMeta } from "../../common/searchResultMeta";

/**
 * 1 倍字体时标签里文字的最小、最大宽度，都按系统字体的倍数放大。
 * 最小宽度放得下「加载中...」「Loading...」：结果回来、说明变成数字时标签不跟着变窄；
 * 最大宽度放得下 5 个粗体汉字的来源名和「Failed to load」，更长的来源名截断。
 */
const MIN_TEXT_WIDTH = 50;
const MAX_TEXT_WIDTH = 76;
const ERROR_COLOR = "#FC5F5F";

interface IResultTabLabelProps {
    title: string;
    focused: boolean;
    meta: ITabMeta;
    /** 失败时整个标签标红（来源标签）；不传时只把说明标红（类别标签） */
    tintOnError?: boolean;
}

/**
 * 搜索结果的类别（单曲、专辑……）和来源标签：名字下面一行小字是结果数、加载中或失败。
 *
 * 标签按文字排宽（有上下限），名字、说明一直跟着系统字体放大。以前标签宽度固定、
 * 文字却跟着放大，字体稍大一点名字和「加载失败」就被截断；英文的「Playlist」
 * 「Failed to load」在默认字体下也放不下。TabBarItem 把选中（粗体）、未选中两份
 * 标签叠在一起，两份必须一样宽：名字先按粗体排一份看不见的占位，看得见的那份
 * 盖在占位上，选中前后宽度不变。
 */
export default function ResultTabLabel(props: IResultTabLabelProps) {
    const { title, focused, meta, tintOnError } = props;
    const colors = useColors();
    const { fontScale } = useWindowDimensions();
    const tinted = !focused && tintOnError && meta.isError;
    const textWidth = {
        minWidth: MIN_TEXT_WIDTH * fontScale,
        maxWidth: MAX_TEXT_WIDTH * fontScale,
    };

    return (
        <View
            style={[
                styles.label,
                {
                    backgroundColor: focused
                        ? Color(colors.primary).alpha(0.1).toString()
                        : tinted
                            ? Color(ERROR_COLOR).alpha(0.08).toString()
                            : "transparent",
                    borderColor: focused
                        ? Color(colors.primary).alpha(0.28).toString()
                        : tinted
                            ? Color(ERROR_COLOR).alpha(0.32).toString()
                            : "transparent",
                },
            ]}>
            <View style={textWidth}>
                <Text
                    numberOfLines={1}
                    accessible={false}
                    importantForAccessibility="no"
                    style={[styles.title, styles.placeholder]}>
                    {title}
                </Text>
                <Text
                    numberOfLines={1}
                    style={[
                        styles.title,
                        StyleSheet.absoluteFill,
                        {
                            fontWeight: focused
                                ? fontWeightConst.bolder
                                : fontWeightConst.medium,
                            color: focused
                                ? colors.primary
                                : colors.textSecondary ?? colors.text,
                        },
                    ]}>
                    {title}
                </Text>
            </View>
            {meta.text ? (
                <Text
                    numberOfLines={1}
                    style={[
                        styles.meta,
                        textWidth,
                        {
                            color: meta.isError
                                ? ERROR_COLOR
                                : focused
                                    ? colors.primary
                                    : colors.textSecondary,
                        },
                    ]}>
                    {meta.text}
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    // 尺寸和以前（rpx）在 363 dp 宽的手机上一样，改成 dp：窄屏上不再更挤
    label: {
        minHeight: 36,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: "center",
        justifyContent: "center",
        rowGap: 1,
    },
    title: {
        textAlign: "center",
    },
    // 按粗体排的占位，只用来定宽度
    placeholder: {
        fontWeight: fontWeightConst.bolder,
        opacity: 0,
    },
    meta: {
        fontSize: fontSizeConst.tag,
        textAlign: "center",
    },
});

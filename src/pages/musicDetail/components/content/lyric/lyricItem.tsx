import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { TextStyle } from "react-native";
import rpx from "@/utils/rpx";
import useColors from "@/hooks/useColors";
import { fontSizeConst } from "@/constants/uiConst";

interface ILyricLine {
    key: string;
    text: string;
    primary: boolean;
}

interface ILyricItemComponentProps {
    // 行号
    index?: number;
    // 显示
    light?: boolean;
    // 高亮
    highlight?: boolean;
    // 文本
    text?: string;
    // 多行歌词
    lines?: ILyricLine[];
    // 字体大小
    fontSize?: number;
    // 副行字号比例
    secondaryFontScale?: number;
    // 对齐方式
    textAlign?: NonNullable<TextStyle["textAlign"]>;

    onLayout?: (index: number, height: number) => void;
}

function _LyricItemComponent(props: ILyricItemComponentProps) {
    const {
        light,
        highlight,
        text,
        lines,
        onLayout,
        index,
        fontSize,
        secondaryFontScale = 0.75,
        textAlign = "center",
    } = props;

    const colors = useColors();
    const displayLines = lines?.length
        ? lines
        : [
            {
                key: "text",
                text: text ?? "",
                primary: true,
            },
        ];
    const primaryFontSize = fontSize || fontSizeConst.content;

    return (
        <View
            onLayout={({ nativeEvent }) => {
                if (index !== undefined) {
                    onLayout?.(index, nativeEvent.layout.height);
                }
            }}
            style={[
                lyricStyles.item,
                highlight
                    ? [
                        lyricStyles.highlightItem,
                    ]
                    : null,
                light ? lyricStyles.draggingItem : null,
            ]}>
            {displayLines.map(line => (
                <Text
                    key={line.key}
                    style={[
                        lyricStyles.line,
                        {
                            color: highlight ? colors.primary : "white",
                            fontSize: line.primary
                                ? primaryFontSize
                                : primaryFontSize * secondaryFontScale,
                            textAlign,
                        },
                        line.primary ? null : lyricStyles.secondaryLine,
                    ]}>
                    {line.text}
                </Text>
            ))}
        </View>
    );
}
// 歌词
const LyricItemComponent = memo(
    _LyricItemComponent,
    (prev, curr) =>
        prev.light === curr.light &&
        prev.highlight === curr.highlight &&
        prev.text === curr.text &&
        prev.lines === curr.lines &&
        prev.index === curr.index &&
        prev.fontSize === curr.fontSize &&
        prev.secondaryFontScale === curr.secondaryFontScale &&
        prev.textAlign === curr.textAlign,
);

export default LyricItemComponent;

const lyricStyles = StyleSheet.create({
    highlightItem: {
        opacity: 1,
    },
    item: {
        opacity: 0.6,
        paddingHorizontal: rpx(64),
        paddingVertical: rpx(24),
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
    },
    line: {
        width: "100%",
        textAlignVertical: "center",
    },
    secondaryLine: {
        marginTop: rpx(6),
        opacity: 0.82,
    },
    draggingItem: {
        opacity: 0.9,
        color: "white",
    },
});

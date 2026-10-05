import React from "react";
import { StyleSheet, Text, useWindowDimensions } from "react-native";
import { fontWeightConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";

/** 1 倍字体时标签名的宽度：放得下 5 个粗体汉字，更长的名字截断 */
const TAB_LABEL_WIDTH = 80;

interface ITabLabelProps {
    title: string;
    focused: boolean;
}

/**
 * 页面顶部标签栏（react-native-tab-view 的 TabBar）里的标签名，选中时粗体、强调色。
 * 推荐歌单、榜单页的音源标签和歌手详情的单曲、专辑标签都用它。
 *
 * 名字（Text）一直跟着系统字体放大，宽度按同样的倍数放大，放大后能放下的字数不变；
 * 以前宽度固定，字体稍大一点五个字的名字就被截断。TabBarItem 把选中（粗体）、
 * 未选中两份文字叠在一起，两份必须同宽，所以不按文字长短自适应。
 */
export default function TabLabel(props: ITabLabelProps) {
    const { title, focused } = props;
    const colors = useColors();
    const { fontScale } = useWindowDimensions();

    return (
        <Text
            numberOfLines={1}
            style={[
                styles.label,
                {
                    width: TAB_LABEL_WIDTH * fontScale,
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
    );
}

const styles = StyleSheet.create({
    label: {
        textAlign: "center",
    },
});

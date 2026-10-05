import React from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import ThemeText from "@/components/base/themeText";
import { useI18N } from "@/core/i18n";

interface IProps {
    notSupportType?: string;
}

export default function NoPlugin(props: IProps) {
    const { t } = useI18N();

    return (
        <View style={style.wrapper}>
            <ThemeText fontSize="title" style={style.text}>
                {props.notSupportType ? t("noPlugin.titleWithType", {
                    type: props.notSupportType,
                }) : t("noPlugin.title")}
            </ThemeText>
            <ThemeText
                style={[style.text, style.mt]}
                fontSize="subTitle"
                fontColor="textSecondary">
                {t("noPlugin.description")}
            </ThemeText>
        </View>
    );
}

const style = StyleSheet.create({
    wrapper: {
        // 以前是 rpx(750)，即屏幕短边：横屏时只占左边一块，文字不在页面中间
        width: "100%",
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        // 字体放大、文字折行时不贴着屏幕边
        paddingHorizontal: 16,
    },
    text: {
        textAlign: "center",
    },
    mt: {
        marginTop: rpx(24),
    },
});

import { RequestStateCode } from "@/constants/commonConst";
import { fontSizeConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import React from "react";
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from "react-native";
import ThemeText from "./themeText";
import { useI18N } from "@/core/i18n";
import { ListSkeleton } from "./skeleton";

interface IEmptyProps {
    state: RequestStateCode
    onRetry?: () => void;
    title?: string;
    description?: string;
    /** 首屏加载时是否使用骨架屏（默认 true），不需要时回退为转圈 */
    skeletonOnLoading?: boolean;
}
export default function ListEmpty(props: IEmptyProps) {
    const { state, onRetry, title, description, skeletonOnLoading = true } = props;

    const colors = useColors();
    const { t } = useI18N();

    if (
        state === RequestStateCode.IDLE ||
        state === RequestStateCode.FINISHED ||
        state === RequestStateCode.PARTLY_DONE
    ) {
        return <View style={style.wrapper}>
            <ThemeText fontSize="title">
                {title ?? t("common.emptyList")}
            </ThemeText>
            {description ? (
                <ThemeText
                    fontSize="description"
                    fontColor="textSecondary"
                    style={style.description}>
                    {description}
                </ThemeText>
            ) : null}
        </View>;
    } else if (state === RequestStateCode.PENDING_FIRST_PAGE) {
        if (skeletonOnLoading) {
            return <ListSkeleton />;
        }
        return <View style={style.wrapper}>
            <ActivityIndicator animating color={colors.text} size={fontSizeConst.appbar}/>
            <ThemeText
                fontSize="title"
                fontWeight="semibold">
                {t("common.loading")}
            </ThemeText>
        </View>;
    } else if (state === RequestStateCode.ERROR) {
        return <View style={style.wrapper}>
            <ThemeText fontSize="title">
                {title ?? t("common.error")}
            </ThemeText>
            {description ? (
                <ThemeText
                    fontSize="description"
                    fontColor="textSecondary"
                    style={style.description}>
                    {description}
                </ThemeText>
            ) : null}
            <TouchableOpacity onPress={onRetry} style={style.retryButton}>
                <ThemeText>{t("common.clickToRetry")}</ThemeText>
            </TouchableOpacity>
        </View>;
    }
 
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
        minHeight: rpx(540),
        justifyContent: "center",
        alignItems: "center",
        gap: rpx(36),
    },
    retryButton: {
        paddingVertical: rpx(24),
        paddingHorizontal: rpx(48),
        borderRadius: rpx(36),
        backgroundColor: "rgba(128, 128, 128, 0.2)",
    },
    description: {
        maxWidth: "80%",
        textAlign: "center",
    },
});

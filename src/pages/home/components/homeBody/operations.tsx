import Icon, { IIconName } from "@/components/base/icon.tsx";
import ThemeText from "@/components/base/themeText";
import { useI18N } from "@/core/i18n";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import Color from "color";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

const HORIZONTAL_PADDING = rpx(24);
const CARD_GAP = rpx(18);
const GRID_COLUMNS = 2;

export default function Operations() {
    const navigate = useNavigate();
    const { t } = useI18N();
    const colors = useColors();
    const [containerWidth, setContainerWidth] = useState(0);

    const actionButtons: {
        key: string;
        iconName: IIconName;
        iconColor: string;
        title: string;
        action: () => void;
    }[] = [
        {
            key: "recommend",
            iconName: "fire-outline",
            iconColor: "#FF8E7D",
            title: t("home.recommendSheet"),
            action() {
                navigate(ROUTE_PATH.RECOMMEND_SHEETS);
            },
        },
        {
            key: "topList",
            iconName: "trophy",
            iconColor: "#F4B85F",
            title: t("home.topList"),
            action() {
                navigate(ROUTE_PATH.TOP_LIST);
            },
        },
        {
            key: "history",
            iconName: "clock-outline",
            iconColor: "#64A7FF",
            title: t("home.playHistory"),
            action() {
                navigate(ROUTE_PATH.HISTORY);
            },
        },
        {
            key: "local",
            iconName: "folder-music-outline",
            iconColor: "#7DD3B8",
            title: t("home.localMusic"),
            action() {
                navigate(ROUTE_PATH.LOCAL);
            },
        },
    ];

    const cardWidth = useMemo(() => {
        if (!containerWidth) {
            return undefined as number | undefined;
        }

        const contentWidth = Math.max(
            0,
            containerWidth - HORIZONTAL_PADDING * 2,
        );
        return Math.max(
            0,
            (contentWidth - CARD_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS,
        );
    }, [containerWidth]);

    return (
        <View
            style={styles.container}
            onLayout={event => {
                const nextWidth = event.nativeEvent.layout.width;
                setContainerWidth(prev =>
                    Math.abs(prev - nextWidth) < 0.5 ? prev : nextWidth,
                );
            }}>
            {actionButtons.map((action, index) => (
                <Pressable
                    style={[
                        styles.actionCard,
                        {
                            backgroundColor: colors.card,
                            borderColor: Color(colors.text)
                                .alpha(0.06)
                                .toString(),
                        },
                        cardWidth !== undefined
                            ? { width: cardWidth }
                            : null,
                        index % GRID_COLUMNS ? styles.actionMarginLeft : null,
                        index >= GRID_COLUMNS ? styles.actionMarginTop : null,
                    ]}
                    key={action.key}
                    onPress={action.action}>
                    <View
                        style={[
                            styles.iconBox,
                            {
                                backgroundColor: Color(action.iconColor)
                                    .alpha(0.16)
                                    .toString(),
                            },
                        ]}>
                        <Icon
                            name={action.iconName}
                            size={rpx(34)}
                            color={action.iconColor}
                        />
                    </View>
                    <ThemeText
                        numberOfLines={2}
                        fontSize="subTitle"
                        fontWeight="semibold"
                        style={styles.actionTitle}>
                        {action.title}
                    </ThemeText>
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: "100%",
        paddingHorizontal: HORIZONTAL_PADDING,
        marginTop: rpx(24),
        marginBottom: rpx(10),
        flexDirection: "row",
        flexWrap: "wrap",
    },
    actionCard: {
        minHeight: rpx(132),
        borderRadius: rpx(18),
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: rpx(16),
        paddingVertical: rpx(18),
        flexDirection: "row",
        alignItems: "center",
        flexGrow: 0,
    },
    iconBox: {
        width: rpx(56),
        height: rpx(56),
        borderRadius: rpx(16),
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    actionTitle: {
        flex: 1,
        minWidth: 0,
        marginLeft: rpx(14),
        lineHeight: rpx(34),
    },
    actionMarginLeft: {
        marginLeft: CARD_GAP,
    },
    actionMarginTop: {
        marginTop: CARD_GAP,
    },
});

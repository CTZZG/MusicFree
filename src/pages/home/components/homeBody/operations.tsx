import { useI18N } from "@/core/i18n";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import rpx from "@/utils/rpx";
import React, { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import ActionButton from "../ActionButton";

const HORIZONTAL_PADDING = rpx(24);
const BUTTON_GAP = rpx(24);
const MIN_BUTTON_WIDTH = rpx(140);
const MAX_COLUMNS = 4;

export default function Operations() {
    const navigate = useNavigate();
    const { t } = useI18N();
    const [containerWidth, setContainerWidth] = useState(0);

    const actionButtons = [
        {
            iconName: "fire",
            title: t("home.recommendSheet"),
            action() {
                navigate(ROUTE_PATH.RECOMMEND_SHEETS);
            },
        },
        {
            iconName: "trophy",
            title: t("home.topList"),
            action() {
                navigate(ROUTE_PATH.TOP_LIST);
            },
        },
        {
            iconName: "clock-outline",
            title: t("home.playHistory"),
            action() {
                navigate(ROUTE_PATH.HISTORY);
            },
        },
        {
            iconName: "folder-music-outline",
            title: t("home.localMusic"),
            action() {
                navigate(ROUTE_PATH.LOCAL);
            },
        },
    ] as const;

    const layout = useMemo(() => {
        if (!containerWidth) {
            return {
                columns: MAX_COLUMNS,
                buttonWidth: undefined as number | undefined,
            };
        }

        const contentWidth = Math.max(
            0,
            containerWidth - HORIZONTAL_PADDING * 2,
        );
        const canFitFourColumns =
            contentWidth >= MIN_BUTTON_WIDTH * MAX_COLUMNS + BUTTON_GAP * 3;
        const columns = canFitFourColumns ? MAX_COLUMNS : 2;
        const buttonWidth =
            (contentWidth - BUTTON_GAP * Math.max(columns - 1, 0)) / columns;

        return {
            columns,
            buttonWidth: Math.max(0, buttonWidth),
        };
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
                <ActionButton
                    style={[
                        styles.actionButtonStyle,
                        layout.buttonWidth !== undefined
                            ? { width: layout.buttonWidth }
                            : null,
                        index % layout.columns ? styles.actionMarginLeft : null,
                        index >= layout.columns ? styles.actionMarginTop : null,
                    ]}
                    key={action.title}
                    {...action}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: "100%",
        paddingHorizontal: HORIZONTAL_PADDING,
        marginVertical: rpx(32),
        flexDirection: "row",
        flexWrap: "wrap",
    },
    actionButtonStyle: {
        width: rpx(157.5),
        height: rpx(160),
        borderRadius: rpx(18),
        flexGrow: 0,
    },
    actionMarginLeft: {
        marginLeft: BUTTON_GAP,
    },
    actionMarginTop: {
        marginTop: BUTTON_GAP,
    },
});

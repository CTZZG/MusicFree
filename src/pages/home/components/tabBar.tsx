import React, { RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import GlassBackdrop from "@/components/base/glassBackdrop";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import ThemeText from "@/components/base/themeText";
import { HOME_TAB } from "@/core/router";
import { useI18N } from "@/core/i18n";
import Theme from "@/core/theme";
import useColors from "@/hooks/useColors";
import {
    MUSIC_BAR_FLOATING_BOTTOM,
    TAB_BAR_HEIGHT,
    TAB_BAR_HORIZONTAL_MARGIN,
} from "@/components/musicBar/layout";
import { useMusicBarLayoutState } from "@/components/musicBar/layoutState";

const TAB_BAR_RADIUS = TAB_BAR_HEIGHT / 2;
const TAB_BAR_PADDING = 6;

const tabIcons: Record<string, IIconName> = {
    [HOME_TAB.HOME]: "home-outline",
    [HOME_TAB.SEARCH]: "magnifying-glass",
    [HOME_TAB.LIBRARY]: "library",
    [HOME_TAB.SETTINGS]: "cog-8-tooth",
};

interface IHomeTabBarProps {
    state: BottomTabBarProps["state"];
    navigation: BottomTabBarProps["navigation"];
    /** 标签页内容外面的 BlurTargetView，标签栏模糊的就是它 */
    blurTarget?: RefObject<View | null>;
}

/** iOS 悬浮标签栏：毛玻璃胶囊，选中的标签用强调色加一层浅色胶囊底 */
export default function HomeTabBar(props: IHomeTabBarProps) {
    const { state, navigation, blurTarget } = props;
    const colors = useColors();
    const dark = Theme.useTheme().dark;
    const safeAreaInsets = useSafeAreaInsets();
    const { keyboardVisible } = useMusicBarLayoutState();
    const { t } = useI18N();

    // 键盘弹出时收起，否则会被顶到键盘上面。不跟着路由判断：进二级页面时
    // 标签栏随主页一起被盖住，提前消失反而会闪一下
    if (keyboardVisible) {
        return null;
    }

    const tabLabels: Record<string, string> = {
        [HOME_TAB.HOME]: t("tabs.home"),
        [HOME_TAB.SEARCH]: t("common.search"),
        [HOME_TAB.LIBRARY]: t("tabs.library"),
        [HOME_TAB.SETTINGS]: t("common.setting"),
    };

    return (
        <View
            accessibilityRole="tablist"
            style={[
                styles.bar,
                dark ? styles.barShadowDark : styles.barShadowLight,
                {
                    bottom: safeAreaInsets.bottom + MUSIC_BAR_FLOATING_BOTTOM,
                    left: TAB_BAR_HORIZONTAL_MARGIN + safeAreaInsets.left,
                    right: TAB_BAR_HORIZONTAL_MARGIN + safeAreaInsets.right,
                },
            ]}>
            <GlassBackdrop
                radius={TAB_BAR_RADIUS}
                intensity={60}
                blurTarget={blurTarget}
            />
            {state.routes.map((route, index) => {
                const focused = state.index === index;
                const label = tabLabels[route.name] ?? route.name;
                const tint = focused ? colors.primary : colors.textSecondary;

                const onPress = () => {
                    const event = navigation.emit({
                        type: "tabPress",
                        target: route.key,
                        canPreventDefault: true,
                    });
                    if (!focused && !event.defaultPrevented) {
                        navigation.navigate(route.name, route.params);
                    }
                };

                return (
                    <Pressable
                        key={route.key}
                        accessibilityRole="tab"
                        accessibilityLabel={label}
                        accessibilityState={{ selected: focused }}
                        onPress={onPress}
                        onLongPress={() => {
                            navigation.emit({
                                type: "tabLongPress",
                                target: route.key,
                            });
                        }}
                        style={[
                            styles.item,
                            focused
                                ? dark
                                    ? styles.itemSelectedDark
                                    : styles.itemSelectedLight
                                : null,
                        ]}>
                        <Icon
                            name={tabIcons[route.name] ?? "musical-note"}
                            size={24}
                            color={tint}
                        />
                        <ThemeText
                            numberOfLines={1}
                            fontWeight="semibold"
                            color={tint}
                            style={styles.label}>
                            {label}
                        </ThemeText>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        position: "absolute",
        height: TAB_BAR_HEIGHT,
        borderRadius: TAB_BAR_RADIUS,
        overflow: "hidden",
        flexDirection: "row",
        padding: TAB_BAR_PADDING,
        gap: 4,
    },
    // 柔和投影，让胶囊和背后同色的卡片分开；投影画在胶囊外面，不受 overflow 裁剪
    barShadowLight: {
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.12)",
    },
    barShadowDark: {
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.45)",
    },
    item: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: TAB_BAR_RADIUS - TAB_BAR_PADDING,
    },
    // 选中标签的浅色胶囊底
    itemSelectedLight: {
        backgroundColor: "rgba(0, 0, 0, 0.07)",
    },
    itemSelectedDark: {
        backgroundColor: "rgba(255, 255, 255, 0.12)",
    },
    label: {
        marginTop: 2,
        fontSize: 10,
        lineHeight: 12,
    },
});

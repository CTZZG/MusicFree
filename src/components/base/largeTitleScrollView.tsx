import React, { ReactNode, useRef } from "react";
import {
    RefreshControlProps,
    ScrollView,
    StyleProp,
    StyleSheet,
    View,
    ViewStyle,
} from "react-native";
import Color from "color";
import Animated, {
    Extrapolation,
    interpolate,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";
import { useScrollToTop } from "@react-navigation/native";
import {
    SafeAreaView,
    useSafeAreaInsets,
} from "react-native-safe-area-context";
import useColors from "@/hooks/useColors";
import useMusicBarFloatingOffset from "@/components/musicBar/useMusicBarFloatingOffset";
import StatusBar from "./statusBar";
import ThemeText from "./themeText";
import { PAGE_MARGIN } from "@/utils/tileLayout";

interface ILargeTitleScrollViewProps {
    title: string;
    /** 大标题下面的一行灰色说明 */
    subtitle?: string;
    /** 大标题右侧的按钮 */
    actions?: ReactNode;
    /**
     * 页面底下铺了背景图（首页）：状态栏不画底色，滚动后出现的小标题栏
     * 用半透明底，背景图能透出来
     */
    translucentChrome?: boolean;
    refreshControl?: React.ReactElement<RefreshControlProps>;
    children?: ReactNode;
    contentContainerStyle?: StyleProp<ViewStyle>;
}

// 大标题滚出这段距离后，顶部出现居中的小标题
const COMPACT_TITLE_FADE = [28, 44];

/**
 * 标签页的大标题布局：28pt 粗体标题跟着内容一起滚动，滚过之后顶部
 * 换成居中的小标题和一条分隔线。再次点击当前标签会滚回顶部。
 */
export default function LargeTitleScrollView(
    props: ILargeTitleScrollViewProps,
) {
    const {
        title,
        subtitle,
        actions,
        translucentChrome = false,
        refreshControl,
        children,
        contentContainerStyle,
    } = props;
    const colors = useColors();
    const safeAreaInsets = useSafeAreaInsets();
    // 悬浮的标签栏、迷你播放器从安全区底部算起，滚动内容铺到屏幕底，要再加上安全区
    const bottomInset =
        safeAreaInsets.bottom + Math.max(useMusicBarFloatingOffset(24), 32);
    const scrollRef = useRef<ScrollView>(null);
    useScrollToTop(scrollRef);

    const scrollY = useSharedValue(0);
    const onScroll = useAnimatedScrollHandler(event => {
        scrollY.value = event.contentOffset.y;
    });
    const compactStyle = useAnimatedStyle(() => ({
        opacity: interpolate(
            scrollY.value,
            COMPACT_TITLE_FADE,
            [0, 1],
            Extrapolation.CLAMP,
        ),
    }));

    return (
        // 状态栏底色是绝对定位的，顶部留白要靠安全区
        <SafeAreaView edges={["top", "left", "right"]} style={styles.root}>
            <StatusBar
                backgroundColor={translucentChrome ? "transparent" : undefined}
            />
            <View style={styles.root}>
                <Animated.ScrollView
                    ref={scrollRef as any}
                    onScroll={onScroll}
                    scrollEventThrottle={16}
                    refreshControl={refreshControl}
                    contentContainerStyle={[
                        { paddingBottom: bottomInset },
                        contentContainerStyle,
                    ]}>
                    <View style={styles.largeHeader}>
                        <View style={styles.titles}>
                            <ThemeText
                                accessibilityRole="header"
                                numberOfLines={1}
                                fontWeight="bold"
                                style={styles.largeTitle}>
                                {title}
                            </ThemeText>
                            {subtitle ? (
                                <ThemeText
                                    numberOfLines={1}
                                    fontSize="subTitle"
                                    fontColor="textSecondary"
                                    style={styles.subtitle}>
                                    {subtitle}
                                </ThemeText>
                            ) : null}
                        </View>
                        {actions ? (
                            <View style={styles.actions}>{actions}</View>
                        ) : null}
                    </View>
                    {children}
                </Animated.ScrollView>
                <Animated.View
                    pointerEvents="none"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[
                        styles.compactBar,
                        {
                            backgroundColor: translucentChrome
                                ? Color(colors.pageBackground)
                                    .alpha(0.92)
                                    .toString()
                                : colors.pageBackground,
                            borderBottomColor: colors.divider,
                        },
                        compactStyle,
                    ]}>
                    <ThemeText
                        numberOfLines={1}
                        fontSize="appbar"
                        fontWeight="semibold">
                        {title}
                    </ThemeText>
                </Animated.View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    largeHeader: {
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        // 与页面内容（分组卡片、封面网格）同一条边
        paddingHorizontal: PAGE_MARGIN,
        paddingTop: 12,
        gap: 12,
    },
    titles: {
        flexShrink: 1,
        minWidth: 0,
    },
    subtitle: {
        marginTop: 2,
    },
    largeTitle: {
        fontSize: 28,
        lineHeight: 34,
        letterSpacing: 0.4,
    },
    actions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 3,
    },
    compactBar: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 44,
        paddingHorizontal: 56,
        alignItems: "center",
        justifyContent: "center",
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
});

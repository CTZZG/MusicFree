import React, { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
    LayoutChangeEvent,
    LayoutRectangle,
    Pressable,
    StatusBar as OriginalStatusBar,
    StyleProp,
    StyleSheet,
    TouchableWithoutFeedback,
    View,
    ViewStyle,
} from "react-native";
import useColors from "@/hooks/useColors";
import StatusBar from "./statusBar";
import color from "color";
import Icon from "./icon";
import { iconSizeConst } from "@/constants/uiConst";
import globalStyle from "@/constants/globalStyle";
import ThemeText from "./themeText";
import { useNavigation, useTheme } from "@react-navigation/native";
import Animated, {
    Easing,
    type EasingFunction,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    runOnJS,
} from "react-native-reanimated";
import Portal from "./portal";
import ListItem from "./listItem";
import { IIconName } from "@/components/base/icon.tsx";

interface IAppBarProps {
    titleTextOpacity?: number;
    withStatusBar?: boolean;
    color?: string;
    actions?: Array<{
        icon: IIconName;
        onPress?: () => void;
        accessibilityLabel?: string;
        /** 现在用不了（例如没有改动可保存）：变淡，点了没反应 */
        disabled?: boolean;
    }>;
    menu?: Array<{
        icon: IIconName;
        title: string;
        show?: boolean;
        onPress?: () => void;
        accessibilityLabel?: string;
    }>;
    menuIcon?: IIconName;
    menuPosition?: "left" | "right";
    menuWithStatusBar?: boolean;
    children?: string | ReactNode;
    containerStyle?: StyleProp<ViewStyle>;
    contentStyle?: StyleProp<ViewStyle>;
    actionComponent?: ReactNode;
    onBackPress?: () => void;
    /** 标签页的根页面没有返回按钮 */
    hideBackButton?: boolean;
    backgroundColor?: string;
    spacious?: boolean;
}

interface PendingMenuAction {
    generation: number;
    action?: () => void;
}

const ANIMATION_EASING: EasingFunction = Easing.out(Easing.exp);
const ANIMATION_DURATION = 200;

const timingConfig = {
    duration: ANIMATION_DURATION,
    easing: ANIMATION_EASING,
};

// iOS 导航栏：标准高度、图标按钮的点击区域与标题两侧的最小留白
const BAR_HEIGHT = 48;
const SPACIOUS_BAR_HEIGHT = 56;
const BAR_BUTTON_SIZE = 44;
const MIN_TITLE_INSET = 52;
// 导航栏左右的内边距；居中标题两侧的留白要算上它，否则长标题会贴到按钮上
const BAR_PADDING = 4;
const SPACIOUS_BAR_PADDING = 8;

interface IBarButtonProps {
    icon: IIconName;
    sizeType?: keyof typeof iconSizeConst;
    tint: string;
    onPress?: () => void;
    onLayout?: (event: LayoutChangeEvent) => void;
    accessibilityLabel: string;
    disabled?: boolean;
}

/**
 * 导航栏按钮：44 宽、和导航栏一样高的点击区域，图标居中。
 * 不能直接把 SVG 图标当按钮：react-native-svg 会把图标自身的宽高写在样式最后，
 * 给的 44 宽被盖掉，能点的只剩图标那么大（22 或 31），⋮、+、返回都很难点中。
 */
function BarButton(props: IBarButtonProps) {
    const {
        icon,
        sizeType = "normal",
        tint,
        onPress,
        onLayout,
        accessibilityLabel,
        disabled = false,
    } = props;
    return (
        <Pressable
            onPress={onPress}
            onLayout={onLayout}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityState={{ disabled }}
            style={({ pressed }) => [
                styles.barButton,
                disabled
                    ? styles.barButtonDisabled
                    : pressed
                        ? styles.barButtonPressed
                        : null,
            ]}>
            <Icon name={icon} size={iconSizeConst[sizeType]} color={tint} />
        </Pressable>
    );
}

/**
 * iOS 风格导航栏：底色与页面一致，返回与操作按钮用强调色，
 * 字符串标题居中显示，两侧留白取左右按钮组中较宽的一侧，标题不会压到按钮。
 */
export default function AppBar(props: IAppBarProps) {
    const {
        titleTextOpacity = 1,
        withStatusBar,
        color: _color,
        actions = [],
        menu = [],
        menuIcon = "ellipsis-vertical",
        menuPosition = "right",
        menuWithStatusBar = true,
        containerStyle,
        contentStyle,
        children,
        actionComponent,
        onBackPress,
        hideBackButton = false,
        backgroundColor,
        spacious = false,
    } = props;

    const colors = useColors();
    const navigation = useNavigation();
    const theme = useTheme();

    const bgColor = backgroundColor ?? colors.appBar ?? colors.pageBackground ?? "transparent";
    const titleColor = _color ?? colors.appBarText ?? colors.text;
    const tintColor = _color ?? colors.primary;

    const [showMenu, setShowMenu] = useState(false);
    const [menuIconLayout, setMenuIconLayout] =
        useState<LayoutRectangle | null>(null);
    const [leftWidth, setLeftWidth] = useState(
        hideBackButton ? 0 : BAR_BUTTON_SIZE,
    );
    const [rightWidth, setRightWidth] = useState(0);
    const scaleRate = useSharedValue(0);
    const menuActionGeneration = useRef(0);
    const pendingMenuAction = useRef<PendingMenuAction | undefined>(undefined);

    const hasMenu = menu?.length > 0;
    const menuOnLeft = hasMenu && menuPosition === "left";
    const transparentSurface = spacious && bgColor === "transparent";
    const centeredTitle = typeof children === "string";
    const titleInset = Math.max(
        MIN_TITLE_INSET,
        (spacious ? SPACIOUS_BAR_PADDING : BAR_PADDING) +
            Math.max(leftWidth, rightWidth),
    );

    const finishMenuClose = useCallback((generation: number) => {
        const pending = pendingMenuAction.current;
        if (pending?.generation !== generation) {
            return;
        }
        pendingMenuAction.current = undefined;
        pending.action?.();
    }, []);

    useEffect(() => {
        if (showMenu) {
            pendingMenuAction.current = undefined;
            scaleRate.value = withTiming(1, timingConfig);
        } else {
            const generation = pendingMenuAction.current?.generation;
            scaleRate.value = withTiming(0, timingConfig, finished => {
                if (finished && generation !== undefined) {
                    runOnJS(finishMenuClose)(generation);
                }
            });
        }
    }, [finishMenuClose, scaleRate, showMenu]);

    useEffect(
        () => () => {
            pendingMenuAction.current = undefined;
        },
        [],
    );

    const transformStyle = useAnimatedStyle(() => {
        return {
            opacity: scaleRate.value,
            transform: [{ scale: 0.92 + scaleRate.value * 0.08 }],
        };
    });

    const rightGroup = (
        <View
            style={styles.buttonGroup}
            onLayout={evt => {
                setRightWidth(evt.nativeEvent.layout.width);
            }}>
            {actions.map((action, index) => (
                <BarButton
                    key={index}
                    icon={action.icon}
                    tint={tintColor}
                    onPress={action.onPress}
                    disabled={action.disabled}
                    accessibilityLabel={
                        action.accessibilityLabel ?? action.icon
                    }
                />
            ))}
            {actionComponent ?? null}
            {hasMenu && !menuOnLeft ? (
                <BarButton
                    icon={menuIcon}
                    onLayout={evt => {
                        setMenuIconLayout(evt.nativeEvent.layout);
                    }}
                    tint={tintColor}
                    onPress={() => {
                        setShowMenu(true);
                    }}
                    accessibilityLabel={menuIcon}
                />
            ) : null}
        </View>
    );

    return (
        <>
            {withStatusBar ? (
                <StatusBar
                    backgroundColor={transparentSurface ? "transparent" : bgColor}
                    barStyle={
                        spacious
                            ? theme.dark
                                ? "light-content"
                                : "dark-content"
                            : undefined
                    }
                />
            ) : null}
            <View style={transparentSurface ? styles.surfaceHeader : null}>
                <View
                    style={[
                        styles.container,
                        spacious ? styles.spaciousContainer : null,
                        containerStyle,
                        { backgroundColor: bgColor },
                    ]}>
                    <View
                        style={styles.buttonGroup}
                        onLayout={evt => {
                            setLeftWidth(evt.nativeEvent.layout.width);
                        }}>
                        {menuOnLeft ? (
                            <BarButton
                                icon={menuIcon}
                                onLayout={evt => {
                                    setMenuIconLayout(evt.nativeEvent.layout);
                                }}
                                tint={tintColor}
                                onPress={() => {
                                    setShowMenu(true);
                                }}
                                accessibilityLabel={menuIcon}
                            />
                        ) : hideBackButton ? null : (
                            <BarButton
                                icon="chevron-left"
                                sizeType="big"
                                tint={tintColor}
                                onPress={
                                    onBackPress ||
                                    (() => {
                                        navigation.goBack();
                                    })
                                }
                                accessibilityLabel="back"
                            />
                        )}
                    </View>
                    {centeredTitle ? (
                        <>
                            <View style={globalStyle.grow} />
                            <View
                                pointerEvents="none"
                                style={[
                                    styles.centeredTitle,
                                    {
                                        left: titleInset,
                                        right: titleInset,
                                    },
                                    contentStyle,
                                ]}>
                                <ThemeText
                                    fontSize="appbar"
                                    fontWeight="semibold"
                                    numberOfLines={1}
                                    style={styles.centeredTitleText}
                                    color={
                                        titleTextOpacity !== 1
                                            ? color(titleColor)
                                                .alpha(titleTextOpacity)
                                                .toString()
                                            : titleColor
                                    }>
                                    {children}
                                </ThemeText>
                            </View>
                        </>
                    ) : (
                        <View
                            style={[
                                globalStyle.grow,
                                styles.content,
                                spacious ? styles.spaciousContent : null,
                                contentStyle,
                            ]}>
                            {children}
                        </View>
                    )}
                    {rightGroup}
                </View>
            </View>
            <Portal>
                {showMenu ? (
                    <TouchableWithoutFeedback
                        onPress={() => {
                            setShowMenu(false);
                        }}>
                        <View style={styles.blocker} />
                    </TouchableWithoutFeedback>
                ) : null}
                <Animated.View
                    pointerEvents={showMenu ? "auto" : "none"}
                    style={[
                        menuOnLeft ? styles.menuLeft : styles.menuRight,
                        {
                            backgroundColor: colors.backdrop,
                            top:
                                (menuIconLayout?.y ?? 0) +
                                (menuIconLayout?.height ?? 0) +
                                6 +
                                (menuWithStatusBar
                                    ? OriginalStatusBar.currentHeight ?? 0
                                    : 0),
                            shadowColor: colors.shadow,
                        },
                        transformStyle,
                        styles.menu,
                    ]}>
                    {menu
                        .filter(it => it.show !== false)
                        .map((it, index) => (
                            <View key={it.title}>
                                {index > 0 ? (
                                    <View
                                        style={[
                                            styles.menuDivider,
                                            { backgroundColor: colors.divider },
                                        ]}
                                    />
                                ) : null}
                                <ListItem
                                    withHorizontalPadding
                                    heightType="small"
                                    accessibilityLabel={
                                        it.accessibilityLabel ?? it.title
                                    }
                                    onPress={() => {
                                        if (!showMenu) {
                                            return;
                                        }
                                        pendingMenuAction.current = {
                                            generation: ++menuActionGeneration.current,
                                            action: it.onPress,
                                        };
                                        setShowMenu(false);
                                    }}>
                                    <ListItem.Content title={it.title} />
                                    <ListItem.ListItemIcon
                                        icon={it.icon}
                                        position="right"
                                        iconSize={20}
                                    />
                                </ListItem>
                            </View>
                        ))}
                </Animated.View>
            </Portal>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        width: "100%",
        zIndex: 10000,
        height: BAR_HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: BAR_PADDING,
    },
    buttonGroup: {
        height: "100%",
        flexDirection: "row",
        alignItems: "center",
    },
    barButton: {
        width: BAR_BUTTON_SIZE,
        height: "100%",
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
    },
    barButtonPressed: {
        opacity: 0.4,
    },
    barButtonDisabled: {
        opacity: 0.35,
    },
    content: {
        flexDirection: "row",
        flexBasis: 0,
        alignItems: "center",
        paddingHorizontal: 8,
    },
    centeredTitle: {
        position: "absolute",
        top: 0,
        bottom: 0,
        justifyContent: "center",
        alignItems: "center",
    },
    centeredTitleText: {
        textAlign: "center",
    },
    spaciousContainer: {
        height: SPACIOUS_BAR_HEIGHT,
        paddingHorizontal: SPACIOUS_BAR_PADDING,
    },
    spaciousContent: {
        paddingHorizontal: 12,
    },
    surfaceHeader: {
        width: "100%",
        overflow: "hidden",
    },
    blocker: {
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 10010,
    },
    // 菜单从按钮所在的角缩放出来
    menuLeft: {
        left: 12,
        transformOrigin: "left top",
    },
    menuRight: {
        right: 12,
        transformOrigin: "right top",
    },
    menu: {
        width: 240,
        maxHeight: 420,
        borderRadius: 14,
        overflow: "hidden",
        zIndex: 10011,
        position: "absolute",
        opacity: 0,
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 12,
    },
    menuDivider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 16,
    },
});

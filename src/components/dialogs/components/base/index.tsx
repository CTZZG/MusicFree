import React, { ReactNode, useEffect, useMemo, useRef } from "react";
import {
    BackHandler,
    NativeEventSubscription,
    StyleProp,
    StyleSheet,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
    ViewStyle,
} from "react-native";
import { vh, vw } from "@/utils/rpx";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { timingConfig } from "@/constants/commonConst";
import useColors from "@/hooks/useColors";
import ThemeText from "@/components/base/themeText";
import Divider from "@/components/base/divider";
import { fontSizeConst } from "@/constants/uiConst";
import { ScrollView } from "react-native-gesture-handler";
import useOrientation from "@/hooks/useOrientation.ts";

interface IDialogProps {
    onDismiss?: () => void;
    children?: ReactNode;
}

function Dialog(props: IDialogProps) {
    const { children, onDismiss } = props;

    const sharedShowValue = useSharedValue(0);
    const colors = useColors();
    const backHandlerRef = useRef<NativeEventSubscription | undefined>(
        undefined,
    );
    const orientation = useOrientation();

    // 对话框宽度：iOS 提示框偏窄，安卓上内容常有列表，取屏宽减边距与 340 中较小的
    const dialogContainerStyle: ViewStyle =
        orientation === "vertical"
            ? {
                width: Math.min(vw(100) - 64, 340),
            }
            : {
                width: "60%",
            };

    useEffect(() => {
        sharedShowValue.value = 1;
        if (backHandlerRef.current) {
            backHandlerRef.current?.remove();
            backHandlerRef.current = undefined;
        }
        backHandlerRef.current = BackHandler.addEventListener(
            "hardwareBackPress",
            () => {
                onDismiss?.();
                return true;
            },
        );

        return () => {
            sharedShowValue.value = 0;
            if (backHandlerRef.current) {
                backHandlerRef.current?.remove();
                backHandlerRef.current = undefined;
            }
        };
    }, []);

    const containerStyle = useAnimatedStyle(() => {
        return {
            opacity: withTiming(
                sharedShowValue.value,
                timingConfig.animationFast,
            ),
        };
    });

    const scaleAnimationStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {
                    scale: withTiming(
                        0.9 + sharedShowValue.value * 0.1,
                        timingConfig.animationFast,
                    ),
                },
            ],
        };
    });

    return (
        <View style={styles.backContainer}>
            <TouchableWithoutFeedback
                style={styles.container}
                onPress={onDismiss}>
                <Animated.View style={[styles.container, containerStyle]} />
            </TouchableWithoutFeedback>
            <Animated.View
                style={[
                    styles.dialogContainer,
                    dialogContainerStyle,
                    containerStyle,
                    scaleAnimationStyle,
                    {
                        backgroundColor: colors.backdrop,
                        shadowColor: colors.shadow,
                    },
                ]}>
                {children}
            </Animated.View>
        </View>
    );
}

interface IDialogTitleProps {
    children?: ReactNode;
    withDivider?: boolean;
    stringContent?: boolean;
    containerStyle?: StyleProp<ViewStyle>;
}

function Title(props: IDialogTitleProps) {
    const { children, withDivider, stringContent, containerStyle } = props;

    return (
        <>
            <View style={[styles.titleContainer, containerStyle]}>
                {typeof children === "string" || stringContent ? (
                    <ThemeText
                        fontSize="title"
                        fontWeight="semibold"
                        numberOfLines={2}
                        style={styles.titleText}>
                        {children}
                    </ThemeText>
                ) : (
                    children
                )}
            </View>
            {withDivider ? <Divider /> : null}
        </>
    );
}

interface IDialogContentProps {
    children?: ReactNode;
    style?: StyleProp<ViewStyle>;
    needScroll?: boolean;
}

function Content(props: IDialogContentProps) {
    const { children, style, needScroll } = props;

    // 短提示像 iOS 一样居中，长文字左对齐便于阅读
    const content =
        typeof children === "string" ? (
            <ThemeText
                fontSize="subTitle"
                style={[
                    styles.defaultFontStyle,
                    children.length <= SHORT_MESSAGE_LENGTH
                        ? styles.centeredText
                        : null,
                ]}>
                {children}
            </ThemeText>
        ) : (
            children
        );

    return (
        <View
            style={[
                styles.contentContainer,
                {
                    maxHeight: vh(50),
                },
                style,
            ]}>
            {needScroll ? <ScrollView>{content}</ScrollView> : content}
        </View>
    );
}

interface IDialogActionsProps {
    children?: ReactNode;
    actions?: Array<{
        title: string;
        type?: "normal" | "primary";
        show?: boolean;
        onPress?: () => void;
    }>;
    style?: StyleProp<ViewStyle>;
}

function Actions(props: IDialogActionsProps) {
    const { children, style, actions } = props;

    const validActions = useMemo(
        () => actions?.filter(it => it.show !== false),
        [actions],
    );

    const colors = useColors();
    // iOS 提示框：两个以内的按钮并排，更多时竖排，按钮之间是发丝分隔线
    const stacked = (validActions?.length ?? 0) > 2;

    const _children = validActions?.length ? (
        <>
            {validActions.map((it, index) =>
                it.show === false ? null : (
                    <BottomButton
                        key={index}
                        style={
                            index === 0
                                ? null
                                : [
                                    stacked
                                        ? styles.stackedSeparator
                                        : styles.inlineSeparator,
                                    { borderColor: colors.divider },
                                ]
                        }
                        stacked={stacked}
                        onPress={it.onPress}
                        text={it.title}
                        type={it.type}
                    />
                ),
            )}
        </>
    ) : (
        children
    );

    return (
        <View
            style={[
                validActions?.length
                    ? [
                        styles.iosActions,
                        stacked ? styles.iosActionsStacked : null,
                        { borderTopColor: colors.divider },
                    ]
                    : styles.actionsContainer,
                style,
            ]}>
            {typeof children === "string" ? (
                <ThemeText fontSize="content" numberOfLines={1}>
                    {children}
                </ThemeText>
            ) : (
                _children
            )}
        </View>
    );
}

function BottomButton(props: {
    type?: "normal" | "primary";
    text: string;
    stacked?: boolean;
    style?: StyleProp<ViewStyle>;
    onPress?: () => void;
}) {
    const { type = "normal", text, stacked, style, onPress } = props;

    return (
        <TouchableOpacity
            activeOpacity={0.5}
            accessibilityRole="button"
            onPress={onPress}
            style={[
                styles.bottomBtn,
                stacked ? styles.bottomBtnStacked : null,
                style,
            ]}>
            <ThemeText
                fontSize="title"
                fontColor="primary"
                numberOfLines={1}
                fontWeight={type === "primary" ? "semibold" : "regular"}>
                {text}
            </ThemeText>
        </TouchableOpacity>
    );
}

const SHORT_MESSAGE_LENGTH = 80;

const styles = StyleSheet.create({
    bottomBtn: {
        flex: 1,
        flexShrink: 0,
        justifyContent: "center",
        alignItems: "center",
        height: 46,
        paddingHorizontal: 8,
    },
    bottomBtnStacked: {
        flex: 0,
        width: "100%",
    },
    backContainer: {
        position: "absolute",
        zIndex: 16299,
        width: "100%",
        height: "100%",
        left: 0,
        top: 0,
        alignItems: "center",
        justifyContent: "center",
    },
    container: {
        zIndex: 16300,
        position: "absolute",
        width: "100%",
        height: "100%",
        left: 0,
        top: 0,
        backgroundColor: "rgba(0, 0, 0, 0.4)",
    },
    dialogContainer: {
        position: "absolute",
        zIndex: 16310,
        borderRadius: 14,
        overflow: "hidden",
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.2,
        shadowRadius: 24,
        elevation: 8,
    },

    defaultFontStyle: {
        lineHeight: fontSizeConst.subTitle * 1.45,
    },
    centeredText: {
        textAlign: "center",
    },

    /**** title */
    titleContainer: {
        minHeight: 44,
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        paddingHorizontal: 16,
        paddingTop: 18,
    },
    titleText: {
        textAlign: "center",
    },
    /** content */
    contentContainer: {
        width: "100%",
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 18,
    },
    /** 自定义按钮区（children） */
    actionsContainer: {
        width: "100%",
        minHeight: 46,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingHorizontal: 16,
        marginBottom: 8,
        flexWrap: "nowrap",
    },
    /** iOS 按钮区 */
    iosActions: {
        width: "100%",
        flexDirection: "row",
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    iosActionsStacked: {
        flexDirection: "column",
    },
    inlineSeparator: {
        borderLeftWidth: StyleSheet.hairlineWidth,
    },
    stackedSeparator: {
        borderTopWidth: StyleSheet.hairlineWidth,
    },
});

Dialog.Title = Title;
Dialog.Content = Content;
Dialog.Actions = Actions;

export default Dialog;

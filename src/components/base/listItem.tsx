import React, { ReactNode } from "react";
import {
    ImageStyle,
    Insets,
    StyleProp,
    StyleSheet,
    TextProps,
    TextStyle,
    TouchableOpacity,
    Pressable,
    View,
    ViewStyle,
} from "react-native";
import rpx from "@/utils/rpx";
import useColors, { CustomizedColors } from "@/hooks/useColors";
import ThemeText from "./themeText";
import {
    fontSizeConst,
    fontWeightConst,
    iconSizeConst,
} from "@/constants/uiConst";
import FastImage from "./fastImage";
import Icon, { IIconName } from "@/components/base/icon.tsx";

interface IListItemProps {
    // 是否有左右边距
    withHorizontalPadding?: boolean;
    // 左边距
    leftPadding?: number;
    // 右边距
    rightPadding?: number;
    // height:
    style?: StyleProp<ViewStyle>;
    // 外层可点击容器样式（卡片背景、边框、阴影等）
    pressableStyle?: StyleProp<ViewStyle>;
    // 高度类型
    heightType?: "big" | "small" | "smallest" | "normal" | "none";
    children?: ReactNode;
    onPress?: () => void;
    onLongPress?: () => void;
    accessibilityLabel?: string;
    accessibilityHint?: string;
    accessibilityState?: {
        selected?: boolean;
        disabled?: boolean;
        checked?: boolean;
    };
}

// iOS 列表：16 的左右边距，固定行高
const defaultPadding = 16;
const defaultActionWidth = rpx(80);

const Size = {
    big: 64,
    normal: 58,
    small: 50,
    smallest: 38,
    none: undefined,
};

function ListItem(props: IListItemProps) {
    const {
        withHorizontalPadding,
        leftPadding = defaultPadding,
        rightPadding = defaultPadding,
        style,
        pressableStyle,
        heightType = "normal",
        children,
        onPress,
        onLongPress,
        accessibilityLabel,
        accessibilityHint,
        accessibilityState,
    } = props;

    const defaultStyle: StyleProp<ViewStyle> = {
        paddingLeft: withHorizontalPadding ? leftPadding : 0,
        paddingRight: withHorizontalPadding ? rightPadding : 0,
        height: Size[heightType],
    };

    const colors = useColors();

    const isPressable = !!(onPress || onLongPress);

    return (
        <Pressable
            style={({ pressed }) => [
                styles.container,
                pressableStyle,
                pressed && isPressable
                    ? { backgroundColor: colors.listActive }
                    : null,
            ]}
            disabled={!isPressable}
            onPress={onPress}
            onLongPress={onLongPress}
            accessible={isPressable}
            accessibilityRole={isPressable ? "button" : undefined}
            accessibilityLabel={accessibilityLabel}
            accessibilityHint={accessibilityHint}
            accessibilityState={accessibilityState}>
            <View style={[styles.container, defaultStyle, style]}>
                {children}
            </View>
        </Pressable>
    );
}

interface IListItemTextProps {
    children?: number | string;
    fontSize?: keyof typeof fontSizeConst;
    fontColor?: keyof CustomizedColors;
    fontWeight?: keyof typeof fontWeightConst;
    width?: number;
    position?: "left" | "right" | "none";
    fixedWidth?: boolean;
    containerStyle?: StyleProp<ViewStyle>;
    contentStyle?: StyleProp<TextStyle>;
    contentProps?: TextProps;
}

function ListItemText(props: IListItemTextProps) {
    const {
        children,
        fontSize,
        fontWeight,
        fontColor,
        position = "left",
        fixedWidth,
        width,
        containerStyle,
        contentStyle,
        contentProps = {},
    } = props;

    const defaultStyle: StyleProp<ViewStyle> = {
        marginRight: position === "left" ? defaultPadding : 0,
        marginLeft: position === "right" ? defaultPadding : 0,
        width: fixedWidth ? width ?? defaultActionWidth : undefined,
        flexBasis: fixedWidth ? width ?? defaultActionWidth : undefined,
    };

    return (
        <View style={[styles.actionBase, defaultStyle, containerStyle]}>
            <ThemeText
                fontSize={fontSize}
                style={contentStyle}
                fontWeight={fontWeight}
                fontColor={fontColor}
                {...contentProps}>
                {children}
            </ThemeText>
        </View>
    );
}

interface IListItemIconProps {
    icon: IIconName;
    iconSize?: number;
    width?: number;
    position?: "left" | "right" | "none";
    fixedWidth?: boolean;
    containerStyle?: StyleProp<ViewStyle>;
    contentStyle?: StyleProp<ViewStyle>;
    onPress?: () => void;
    color?: string;
     hitSlop?: null | Insets | number | undefined;
    accessibilityLabel?: string;
}

function ListItemIcon(props: IListItemIconProps) {
    const {
        icon,
        iconSize = iconSizeConst.normal,
        position = "left",
        fixedWidth,
        width,
        containerStyle,
        contentStyle,
        onPress,
        color,
        hitSlop,
        accessibilityLabel,
    } = props;

    const colors = useColors();

    const defaultStyle: StyleProp<ViewStyle> = {
        marginRight: position === "left" ? defaultPadding : 0,
        marginLeft: position === "right" ? defaultPadding : 0,
        width: fixedWidth ? width ?? defaultActionWidth : undefined,
        flexBasis: fixedWidth ? width ?? defaultActionWidth : undefined,
    };

    const innerContent = (
        <View style={[styles.actionBase, defaultStyle, containerStyle]}>
            <Icon
                name={icon}
                size={iconSize}
                style={contentStyle}
                color={color || colors.text}
            />
        </View>
    );

    return onPress ? (
        <TouchableOpacity
            style={styles.actionPressable}
            hitSlop={hitSlop}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}>
            {innerContent}
        </TouchableOpacity>
    ) : (
        innerContent
    );
}

interface IListItemImageProps {
    uri?: string;
    fallbackImg?: number;
    imageSize?: number;
    width?: number;
    position?: "left" | "right";
    fixedWidth?: boolean;
    containerStyle?: StyleProp<ViewStyle>;
    contentStyle?: StyleProp<ImageStyle>;
    maskIcon?: IIconName | null;
}

function ListItemImage(props: IListItemImageProps) {
    const {
        uri,
        fallbackImg,
        position = "left",
        fixedWidth,
        width,
        containerStyle,
        contentStyle,
        maskIcon,
    } = props;

    const defaultStyle: StyleProp<ViewStyle> = {
        marginRight: position === "left" ? defaultPadding : 0,
        marginLeft: position === "right" ? defaultPadding : 0,
        width: fixedWidth ? width ?? defaultActionWidth : undefined,
        flexBasis: fixedWidth ? width ?? defaultActionWidth : undefined,
    };

    return (
        <View style={[styles.actionBase, defaultStyle, containerStyle]}>
            <FastImage
                style={[styles.leftImage, contentStyle]}
                source={uri}
                placeholderSource={fallbackImg}
            />
            {maskIcon ? (
                <View style={[styles.leftImage, styles.imageMask]}>
                    <Icon
                        name={maskIcon}
                        size={iconSizeConst.normal}
                        color="red"
                    />
                </View>
            ) : null}
        </View>
    );
}

interface IContentProps {
    title?: ReactNode;
    children?: ReactNode;
    description?: ReactNode;
    containerStyle?: StyleProp<ViewStyle>;
}

function Content(props: IContentProps) {
    const {
        children,
        title = children,
        description = null,
        containerStyle,
    } = props;

    let realTitle;
    let realDescription;

    if (typeof title === "string" || typeof title === "number") {
        realTitle = <ThemeText numberOfLines={1}>{title}</ThemeText>;
    } else {
        realTitle = title;
    }

    if (typeof description === "string" || typeof description === "number") {
        realDescription = (
            <ThemeText
                numberOfLines={1}
                fontSize="description"
                fontColor="textSecondary"
                style={styles.contentDesc}>
                {description}
            </ThemeText>
        );
    } else {
        realDescription = description;
    }

    return (
        <View style={[styles.itemContentContainer, containerStyle]}>
            {realTitle}
            {realDescription}
        </View>
    );
}

/** iOS 分组列表的小标题：灰色小字 */
export function ListItemHeader(props: { children?: ReactNode }) {
    const { children } = props;
    return (
        <ListItem
            withHorizontalPadding
            heightType="smallest"
            style={styles.listItemHeader}>
            {typeof children === "string" ? (
                <ThemeText fontSize="description" fontColor="textSecondary">
                    {children}
                </ThemeText>
            ) : (
                children
            )}
        </ListItem>
    );
}

const styles = StyleSheet.create({
    /** listitem */
    container: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
    },
    /**
     * 可点的图标：点击层撑满行高、图标在里面竖直居中，点击区域是整行的高度。
     * 行只有最小高度时，里面那层的 stretch 跨不过点击层，点击区域会缩成图标那么大，
     * 点图标上下就点到了整行。左右的间距（margin）仍在点击层里，宽度和以前一样
     */
    actionPressable: {
        alignSelf: "stretch",
        justifyContent: "center",
    },
    /** left */
    actionBase: {
        // 占满行高。不用 height: "100%"：行只有最小高度（随文字变高）时，Yoga 按
        // 百分比算出的高度不对，行会被撑得很高
        alignSelf: "stretch",
        flexShrink: 0,
        flexGrow: 0,
        flexBasis: 0,
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
    },

    leftImage: {
        width: rpx(80),
        height: rpx(80),
        borderRadius: 8,
    },
    imageMask: {
        position: "absolute",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#00000022",
    },
    itemContentContainer: {
        flex: 1,
        minWidth: 0,
        alignSelf: "stretch",
        justifyContent: "center",
    },
    contentDesc: {
        marginTop: 3,
    },

    listItemHeader: {
        marginTop: 20,
        alignItems: "flex-end",
        paddingBottom: 6,
    },
});

ListItem.Size = Size;
ListItem.ListItemIcon = ListItemIcon;
ListItem.ListItemImage = ListItemImage;
ListItem.ListItemText = ListItemText;
ListItem.Content = Content;

export default ListItem;

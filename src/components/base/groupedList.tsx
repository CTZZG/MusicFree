import React, { ReactNode } from "react";
import {
    Pressable,
    StyleProp,
    StyleSheet,
    View,
    ViewStyle,
} from "react-native";
import useColors from "@/hooks/useColors";
import ThemeText from "./themeText";
import Icon, { IIconName } from "./icon";
import type { CardGroupPosition } from "./cardGroupPosition";

interface IGroupedSectionProps {
    /** 卡片上方的灰色小标题 */
    title?: string;
    /** 卡片下方的灰色说明 */
    footer?: string;
    /** 行间分隔线距左边缘的距离；带图标块的行用 60 */
    dividerInset?: number;
    children?: ReactNode;
    style?: StyleProp<ViewStyle>;
}

/**
 * iOS 分组列表的一个分组：灰底上的圆角白卡片，行与行之间自动加发丝分隔线。
 */
export function GroupedSection(props: IGroupedSectionProps) {
    const { title, footer, dividerInset = 16, children, style } = props;
    const colors = useColors();
    const rows = React.Children.toArray(children).filter(Boolean);

    return (
        <View style={[styles.section, style]}>
            {title ? (
                <ThemeText
                    fontSize="description"
                    fontColor="textSecondary"
                    style={styles.header}>
                    {title}
                </ThemeText>
            ) : null}
            <View style={[styles.card, { backgroundColor: colors.card }]}>
                {rows.map((row, index) => (
                    <React.Fragment key={index}>
                        {index > 0 ? (
                            <View
                                style={[
                                    styles.divider,
                                    {
                                        marginLeft: dividerInset,
                                        backgroundColor: colors.divider,
                                    },
                                ]}
                            />
                        ) : null}
                        {row}
                    </React.Fragment>
                ))}
            </View>
            {footer ? (
                <ThemeText
                    fontSize="description"
                    fontColor="textSecondary"
                    style={styles.footer}>
                    {footer}
                </ThemeText>
            ) : null}
        </View>
    );
}

interface IGroupedRowProps {
    title: string;
    /** 标题下方的说明 */
    subtitle?: string;
    /** 右侧的当前值 */
    value?: string;
    /** 左侧彩色图标块里的图标 */
    icon?: IIconName;
    /** 图标块底色 */
    iconTint?: string;
    /** 图标不放色块，直接用强调色画（资料库这类导航列表） */
    plainIcon?: boolean;
    /** 右侧附件：箭头、勾选、或自定义节点（比如开关） */
    accessory?: "chevron" | "check" | "none" | ReactNode;
    /** 危险操作：标题用红色 */
    destructive?: boolean;
    onPress?: () => void;
    accessibilityLabel?: string;
    accessibilityHint?: string;
    /** 比如开关行的 checked */
    accessibilityState?: { checked?: boolean; selected?: boolean };
}

/** iOS 分组列表的一行 */
export function GroupedRow(props: IGroupedRowProps) {
    const {
        title,
        subtitle,
        value,
        icon,
        iconTint,
        plainIcon = false,
        accessory = "none",
        destructive,
        onPress,
        accessibilityLabel,
        accessibilityHint,
        accessibilityState,
    } = props;
    const colors = useColors();
    const checked = accessory === "check";

    let accessoryNode: ReactNode = null;
    if (accessory === "chevron") {
        accessoryNode = (
            <Icon
                name="chevron-right"
                size={16}
                color={colors.textSecondary}
                style={styles.chevron}
            />
        );
    } else if (checked) {
        accessoryNode = <Icon name="check" size={20} color={colors.primary} />;
    } else if (accessory !== "none") {
        accessoryNode = accessory;
    }

    return (
        <Pressable
            disabled={!onPress}
            onPress={onPress}
            // 不可点的行（比如右侧放开关）不合并成一个无障碍节点，开关才能单独聚焦
            accessible={!!onPress}
            accessibilityRole={onPress ? "button" : undefined}
            accessibilityLabel={
                accessibilityLabel ??
                [title, value, subtitle].filter(Boolean).join("，")
            }
            accessibilityHint={accessibilityHint}
            accessibilityState={
                accessibilityState ?? (checked ? { selected: true } : undefined)
            }
            style={({ pressed }) => [
                styles.row,
                subtitle ? styles.rowWithSubtitle : null,
                pressed && onPress
                    ? { backgroundColor: colors.listActive }
                    : null,
            ]}>
            {icon && plainIcon ? (
                <Icon
                    name={icon}
                    size={24}
                    color={iconTint ?? colors.primary}
                    style={styles.plainIcon}
                />
            ) : null}
            {icon && !plainIcon ? (
                <View
                    style={[
                        styles.iconTile,
                        { backgroundColor: iconTint ?? colors.primary },
                    ]}>
                    <Icon name={icon} size={18} color="#FFFFFF" />
                </View>
            ) : null}
            <View style={styles.texts}>
                <ThemeText
                    // 设置项的标题可能较长，最多折成两行
                    numberOfLines={2}
                    color={destructive ? colors.danger : undefined}>
                    {title}
                </ThemeText>
                {subtitle ? (
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        style={styles.subtitle}>
                        {subtitle}
                    </ThemeText>
                ) : null}
            </View>
            {value ? (
                <ThemeText
                    numberOfLines={1}
                    fontColor="textSecondary"
                    style={styles.value}>
                    {value}
                </ThemeText>
            ) : null}
            {accessoryNode}
        </Pressable>
    );
}

interface IGroupedCellProps {
    position: CardGroupPosition;
    /** 行间分隔线距左边缘的距离 */
    dividerInset?: number;
    children?: ReactNode;
}

/**
 * 虚拟列表（SectionList 等）里用：一行就是分组卡片的一段，首尾圆角，
 * 中间的行顶上画分隔线。不在虚拟列表里时直接用 GroupedSection。
 */
export function GroupedCell(props: IGroupedCellProps) {
    const { position, dividerInset = 16, children } = props;
    const colors = useColors();
    const roundTop = position === "single" || position === "first";
    const roundBottom = position === "single" || position === "last";

    return (
        <View
            style={[
                styles.cell,
                { backgroundColor: colors.card },
                roundTop ? styles.cellTop : null,
                roundBottom ? styles.cellBottom : null,
            ]}>
            {roundTop ? null : (
                <View
                    style={[
                        styles.divider,
                        {
                            marginLeft: dividerInset,
                            backgroundColor: colors.divider,
                        },
                    ]}
                />
            )}
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    cell: {
        marginHorizontal: 16,
        overflow: "hidden",
    },
    cellTop: {
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
    },
    cellBottom: {
        borderBottomLeftRadius: 14,
        borderBottomRightRadius: 14,
    },
    section: {
        marginTop: 22,
    },
    header: {
        marginHorizontal: 32,
        marginBottom: 7,
    },
    footer: {
        marginHorizontal: 32,
        marginTop: 7,
    },
    card: {
        marginHorizontal: 16,
        borderRadius: 14,
        overflow: "hidden",
    },
    divider: {
        height: StyleSheet.hairlineWidth,
    },
    row: {
        minHeight: 50,
        paddingHorizontal: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    rowWithSubtitle: {
        paddingVertical: 10,
    },
    plainIcon: {
        marginHorizontal: 3,
    },
    iconTile: {
        width: 30,
        height: 30,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    texts: {
        flex: 1,
        minWidth: 0,
    },
    subtitle: {
        marginTop: 2,
    },
    value: {
        maxWidth: "45%",
    },
    chevron: {
        marginLeft: -4,
    },
});

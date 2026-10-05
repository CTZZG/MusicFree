import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { useAtomValue } from "jotai";
import { scrollToTopAtom } from "../store/atoms";
import ThemeText from "@/components/base/themeText";
import Tag from "@/components/base/tag";
import { useParams } from "@/core/router";
import Image from "@/components/base/image";
import { ImgAsset } from "@/constants/assetsConst";
import { useI18N } from "@/core/i18n";

/** 量到头部内容的高度之前不限高 */
const UNMEASURED_MAX_HEIGHT = 10000;

interface IHeaderProps {
    neverFold?: boolean;
}

/**
 * 歌手详情的头部：头像、名字和来源、粉丝数、简介。竖屏时列表往下滚，头部收起让出地方，
 * 滚回顶部再展开；横屏时在左边一栏，一直展开。
 *
 * 高度跟着内容走（字体放大时变高），收起、展开在 0 和量到的内容高度之间变化。以前
 * 头部固定 350rpx 高，字体一大，简介就压到下面的标签上。
 */
export default function Header(props: IHeaderProps) {
    const { neverFold } = props;

    const { artistItem } = useParams<"artist-detail">();

    const scrollToTopState = useAtomValue(scrollToTopAtom);
    const expanded = neverFold || scrollToTopState;
    // 1：完整展开；0：收起
    const expansion = useSharedValue(expanded ? 1 : 0);
    const [contentHeight, setContentHeight] = useState(0);

    const { t } = useI18N();

    const foldStyle = useAnimatedStyle(() => {
        return {
            maxHeight: contentHeight
                ? expansion.value * contentHeight
                : UNMEASURED_MAX_HEIGHT,
            opacity: expansion.value,
        };
    }, [contentHeight]);

    const avatar = artistItem.avatar?.startsWith("//")
        ? `https:${artistItem.avatar}`
        : artistItem.avatar;

    /** 折叠 */
    useEffect(() => {
        expansion.value = withTiming(expanded ? 1 : 0);
    }, [expanded, expansion]);

    return (
        <Animated.View style={[styles.wrapper, foldStyle]}>
            <View
                onLayout={event => {
                    setContentHeight(event.nativeEvent.layout.height);
                }}>
                <View style={styles.headerWrapper}>
                    <Image
                        emptySrc={ImgAsset.albumDefault}
                        uri={avatar}
                        style={styles.artist}
                    />
                    <View style={styles.info}>
                        <View style={styles.title}>
                            <ThemeText
                                fontSize="title"
                                style={styles.titleText}
                                numberOfLines={1}
                                ellipsizeMode="tail">
                                {artistItem?.name ?? ""}
                            </ThemeText>
                            {artistItem.platform ? (
                                <Tag
                                    tagName={artistItem.platform}
                                    containerStyle={styles.tag}
                                />
                            ) : null}
                        </View>

                        {artistItem.fans ? (
                            <ThemeText
                                fontSize="subTitle"
                                fontColor="textSecondary">
                                {t("artistDetail.fansCount", {
                                    count: artistItem.fans,
                                })}
                            </ThemeText>
                        ) : null}
                    </View>
                </View>

                <ThemeText
                    style={styles.description}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                    fontColor="textSecondary"
                    fontSize="description">
                    {artistItem?.description ?? ""}
                </ThemeText>
            </View>
        </Animated.View>
    );
}

// 默认字体时和以前固定 350rpx 高的头部一样高；字体放大时跟着内容变高
const styles = StyleSheet.create({
    wrapper: {
        width: rpx(750),
        backgroundColor: "rgba(28, 28, 28, 0.1)",
        zIndex: 1,
        // 收起时内容不露出来
        overflow: "hidden",
    },
    artist: {
        width: rpx(144),
        height: rpx(144),
        borderRadius: rpx(16),
    },
    headerWrapper: {
        width: rpx(750),
        paddingTop: rpx(24),
        paddingHorizontal: rpx(24),
        minHeight: rpx(240),
        flexDirection: "row",
        alignItems: "center",
    },
    // 占满头像右边剩下的宽度：名字太长时截断，不把来源角标挤出屏幕
    info: {
        flex: 1,
        minWidth: 0,
        marginLeft: rpx(24),
        justifyContent: "space-around",
        minHeight: rpx(144),
    },
    title: {
        flexDirection: "row",
        alignItems: "center",
    },
    titleText: {
        flexShrink: 1,
        marginRight: rpx(18),
    },
    // 来源名特别长时截断（和列表行里的来源角标一样宽）
    tag: {
        maxWidth: rpx(176),
    },
    description: {
        marginTop: rpx(24),
        marginBottom: rpx(24),
        width: rpx(750),
        paddingHorizontal: rpx(24),
    },
});

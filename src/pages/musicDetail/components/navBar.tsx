import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import rpx from "@/utils/rpx";
import { useNavigation } from "@react-navigation/native";
import Tag from "@/components/base/tag";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import Share from "react-native-share";
import { B64Asset } from "@/constants/assetsConst";
import IconButton from "@/components/base/iconButton";
import { useCurrentMusic } from "@/core/trackPlayer";
import { CastButton } from "react-native-nitro-player";
import { useAppConfig } from "@/core/appConfig";
import { isCastButtonVisible, useCastReady } from "@/core/cast";

interface INavBarProps {
    compact?: boolean;
    onTitlePress?: () => void;
}

export default function NavBar(props: INavBarProps) {
    const { compact = false, onTitlePress } = props;
    const navigation = useNavigation();
    const musicItem = useCurrentMusic();
    const playerBackend = useAppConfig("basic.playerBackend");
    const castReady = useCastReady();
    const showCastButton = isCastButtonVisible(
        playerBackend,
        castReady,
    );
    // const {showShare} = useShare();

    return (
        <View
            style={[
                styles.container,
                compact ? styles.compactContainer : null,
            ]}>
            <IconButton
                name="arrow-left"
                sizeType={"normal"}
                color="white"
                style={styles.button}
                onPress={() => {
                    navigation.goBack();
                }}
            />
            {compact ? (
                <View style={styles.headerContent} />
            ) : (
                <Pressable
                    accessibilityHint={
                        onTitlePress ? "返回沉浸式封面页" : undefined
                    }
                    accessibilityLabel={
                        onTitlePress
                            ? `${musicItem?.title ?? "当前歌曲"}，返回封面页`
                            : undefined
                    }
                    accessibilityRole={onTitlePress ? "button" : undefined}
                    disabled={!onTitlePress}
                    onPress={onTitlePress}
                    style={styles.headerContent}>
                    <Text numberOfLines={1} style={styles.headerTitleText}>
                        {musicItem?.title ?? "--"}
                    </Text>
                    <View style={styles.headerDesc}>
                        <Text style={styles.headerArtistText} numberOfLines={1}>
                            {musicItem?.artist}
                        </Text>
                        {musicItem?.platform ? (
                            <Tag
                                tagName={musicItem.platform}
                                containerStyle={styles.tagBg}
                                style={styles.tagText}
                            />
                        ) : null}
                    </View>
                </Pressable>
            )}
            {/* Cast 初始化失败或当前使用 MPV 后端时不展示入口；初始化成功后，
                CastButton 仍会在网络中没有可用设备时自行隐藏。 */}
            {showCastButton ? (
                <CastButton
                    size={rpx(44)}
                    color="white"
                    style={styles.button}
                />
            ) : null}
            <IconButton
                name="share"
                color="white"
                sizeType="normal"
                style={styles.button}
                onPress={async () => {
                    try {
                        await Share.open({
                            type: "image/jpeg",
                            title: "MusicFree-一个插件化的免费音乐播放器",
                            message: "MusicFree-一个插件化的免费音乐播放器",
                            url: B64Asset.share,
                            subject: "MusicFree分享",
                        });
                    } catch {}
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: "100%",
        height: rpx(150),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    compactContainer: {
        height: rpx(112),
    },
    button: {
        marginHorizontal: rpx(20),
    },
    headerContent: {
        flex: 1,
        height: rpx(150),
        justifyContent: "center",
        alignItems: "center",
    },
    headerTitleText: {
        color: "white",
        fontWeight: fontWeightConst.semibold,
        fontSize: fontSizeConst.title,
        marginBottom: rpx(12),
        includeFontPadding: false,
    },
    headerDesc: {
        height: rpx(32),
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: rpx(40),
    },
    headerArtistText: {
        color: "white",
        fontSize: fontSizeConst.subTitle,
        includeFontPadding: false,
    },
    tagBg: {
        backgroundColor: "rgba(255, 255, 255, 0.2)",
    },
    tagText: {
        color: "white",
    },
});

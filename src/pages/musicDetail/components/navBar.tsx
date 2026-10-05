import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import Share from "react-native-share";
import FastImage from "@/components/base/fastImage";
import Icon from "@/components/base/icon.tsx";
import { ImgAsset, B64Asset } from "@/constants/assetsConst";
import { fontWeightConst, maxFontScaleConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
import { useCurrentMusic } from "@/core/trackPlayer";
import { useMusicDetailVisuals } from "../artworkContext";

interface INavBarProps {
    /** 封面页：只显示“正在播放”；歌词页显示小封面和歌名 */
    compact?: boolean;
    onTitlePress?: () => void;
}

function BarButton(props: {
    icon: "chevron-down" | "share";
    accessibilityLabel: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.button,
                pressed ? styles.pressed : null,
            ]}>
            <Icon
                name={props.icon}
                size={props.icon === "chevron-down" ? 26 : 22}
                color="rgba(255, 255, 255, 0.9)"
            />
        </Pressable>
    );
}

export default function NavBar(props: INavBarProps) {
    const { compact = false, onTitlePress } = props;
    const navigation = useNavigation();
    const musicItem = useCurrentMusic();
    const { displayArtwork } = useMusicDetailVisuals();
    const { t } = useI18N();

    return (
        <View style={styles.container}>
            <BarButton
                icon="chevron-down"
                accessibilityLabel={t("musicDetail.collapse.a11y")}
                onPress={() => {
                    navigation.goBack();
                }}
            />
            {compact ? (
                <View style={styles.center}>
                    <Text
                        maxFontSizeMultiplier={maxFontScaleConst.compact}
                        style={styles.nowPlaying}>
                        {t("musicDetail.nowPlaying")}
                    </Text>
                </View>
            ) : (
                <Pressable
                    accessibilityRole={onTitlePress ? "button" : undefined}
                    accessibilityLabel={`${musicItem?.title ?? "--"}，${
                        musicItem?.artist ?? ""
                    }`}
                    accessibilityHint={
                        onTitlePress ? t("musicDetail.showCover.a11y") : undefined
                    }
                    disabled={!onTitlePress}
                    onPress={onTitlePress}
                    style={styles.titleArea}>
                    <FastImage
                        style={styles.artwork}
                        source={displayArtwork}
                        placeholderSource={ImgAsset.albumDefault}
                    />
                    <View style={styles.titleTexts}>
                        <Text
                            numberOfLines={1}
                            maxFontSizeMultiplier={maxFontScaleConst.compact}
                            style={styles.title}>
                            {musicItem?.title ?? "--"}
                        </Text>
                        {musicItem?.artist ? (
                            <Text
                                numberOfLines={1}
                                maxFontSizeMultiplier={maxFontScaleConst.compact}
                                style={styles.artist}>
                                {musicItem.artist}
                            </Text>
                        ) : null}
                    </View>
                </Pressable>
            )}
            <BarButton
                icon="share"
                accessibilityLabel={t("musicDetail.shareApp.a11y")}
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
        height: 64,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
    },
    button: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    pressed: {
        opacity: 0.5,
    },
    center: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    nowPlaying: {
        color: "rgba(255, 255, 255, 0.78)",
        fontSize: 13,
        lineHeight: 18,
        fontWeight: fontWeightConst.semibold,
        includeFontPadding: false,
    },
    titleArea: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 4,
    },
    artwork: {
        width: 44,
        height: 44,
        borderRadius: 8,
    },
    titleTexts: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        color: "white",
        fontSize: 17,
        lineHeight: 22,
        fontWeight: fontWeightConst.semibold,
        includeFontPadding: false,
    },
    artist: {
        color: "rgba(255, 255, 255, 0.72)",
        fontSize: 15,
        lineHeight: 20,
        includeFontPadding: false,
    },
});

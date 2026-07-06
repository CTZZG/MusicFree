import FastImage from "@/components/base/fastImage";
import ThemeText from "@/components/base/themeText";
import { ImgAsset } from "@/constants/assetsConst";
import { useI18N } from "@/core/i18n";
import TrackPlayer from "@/core/trackPlayer";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import Color from "color";
import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import ClassicSection from "./classicSection";

function getMusicDescription(musicItem?: IMusic.IMusicItem | null) {
    if (!musicItem) {
        return "";
    }
    return [musicItem.artist, musicItem.platform].filter(Boolean).join(" · ");
}

export default function ClassicRecentListening(props: {
    musics: IMusic.IMusicItem[];
}) {
    const { musics } = props;
    const colors = useColors();
    const { t } = useI18N();

    if (!musics.length) {
        return null;
    }

    return (
        <ClassicSection title={t("home.recentListening")} compact>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.container}>
                {musics.map(musicItem => (
                    <Pressable
                        key={`${musicItem.platform}-${musicItem.id}`}
                        style={[
                            styles.item,
                            {
                                backgroundColor: colors.card,
                                borderColor: Color(colors.text)
                                    .alpha(0.06)
                                    .toString(),
                            },
                        ]}
                        onPress={() => TrackPlayer.play(musicItem)}>
                        <FastImage
                            source={musicItem.artwork}
                            placeholderSource={ImgAsset.albumDefault}
                            style={styles.cover}
                        />
                        <View style={styles.text}>
                            <ThemeText
                                numberOfLines={1}
                                fontSize="description"
                                fontWeight="semibold">
                                {musicItem.title}
                            </ThemeText>
                            <ThemeText
                                numberOfLines={1}
                                fontSize="tag"
                                fontColor="textSecondary"
                                style={styles.description}>
                                {getMusicDescription(musicItem)}
                            </ThemeText>
                        </View>
                    </Pressable>
                ))}
            </ScrollView>
        </ClassicSection>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: rpx(24),
    },
    item: {
        width: rpx(270),
        minHeight: rpx(90),
        borderRadius: rpx(16),
        borderWidth: StyleSheet.hairlineWidth,
        flexDirection: "row",
        alignItems: "center",
        padding: rpx(12),
        marginRight: rpx(14),
    },
    cover: {
        width: rpx(66),
        height: rpx(66),
        borderRadius: rpx(12),
    },
    text: {
        flex: 1,
        minWidth: 0,
        marginLeft: rpx(12),
    },
    description: {
        marginTop: rpx(8),
    },
});

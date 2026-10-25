import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import { iconSizeConst } from "@/constants/uiConst";
import TranslationIcon from "@/assets/icons/translation.svg";
import useColors from "@/hooks/useColors";
import { showPanel } from "@/components/panels/usePanel";
import TrackPlayer from "@/core/trackPlayer";
import PersistStatus from "@/utils/persistStatus";
import useOrientation from "@/hooks/useOrientation";
import HeartIcon from "../heartIcon";
import Icon from "@/components/base/icon";
import { useLyricState } from "@/core/lyricManager";
import { useI18N } from "@/core/i18n";
import { DEFAULT_DETAIL_LYRIC_FONT_SIZE_INDEX } from "@/utils/detailLyricFontSize";

interface Props {
    scrollToCurrentLrcItem: () => void;
}

export default function LyricOperations({ scrollToCurrentLrcItem }: Props) {
    const detailFontSize = PersistStatus.useValue(
        "lyric.detailFontSize",
        DEFAULT_DETAIL_LYRIC_FONT_SIZE_INDEX,
    );
    const showTranslation =
        PersistStatus.useValue("lyric.showTranslation", false) ?? false;
    const { hasTranslation } = useLyricState();
    const colors = useColors();
    const orientation = useOrientation();
    const { t } = useI18N();
    return (
        <View style={styles.container}>
            {orientation === "vertical" ? <HeartIcon /> : null}
            <Pressable
                style={styles.button}
                accessibilityRole="button"
                accessibilityLabel={t("panel.setFontSize.title")}
                onPress={() =>
                    showPanel("SetFontSize", {
                        defaultSelect:
                            detailFontSize ?? DEFAULT_DETAIL_LYRIC_FONT_SIZE_INDEX,
                        onSelectChange(value) {
                            PersistStatus.set("lyric.detailFontSize", value);
                            scrollToCurrentLrcItem();
                        },
                    })
                }>
                <Icon name="font-size" size={iconSizeConst.normal} color="white" />
            </Pressable>
            <Pressable
                style={styles.button}
                accessibilityRole="switch"
                accessibilityLabel={t("lyricTools.translation")}
                accessibilityState={{
                    checked: showTranslation,
                    disabled: !hasTranslation,
                }}
                disabled={!hasTranslation}
                onPress={() => {
                    PersistStatus.set("lyric.showTranslation", !showTranslation);
                    scrollToCurrentLrcItem();
                }}>
                <TranslationIcon
                    width={iconSizeConst.normal}
                    height={iconSizeConst.normal}
                    opacity={!hasTranslation ? 0.2 : showTranslation ? 1 : 0.5}
                    color={showTranslation && hasTranslation ? colors.primary : "white"}
                />
            </Pressable>
            <Pressable
                style={styles.button}
                accessibilityRole="button"
                accessibilityLabel={t("lyricTools.title")}
                onPress={() => {
                    const musicItem = TrackPlayer.currentMusic;
                    if (musicItem)
                        showPanel("LyricTools", {
                            musicItem,
                            onDisplayChanged: scrollToCurrentLrcItem,
                        });
                }}>
                <Icon
                    name="ellipsis-vertical"
                    size={iconSizeConst.normal}
                    color="white"
                />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        height: rpx(88),
        marginBottom: rpx(8),
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-around",
    },
    button: {
        minWidth: 48,
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
    },
});

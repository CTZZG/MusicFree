import React from "react";
import { StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import { iconSizeConst } from "@/constants/uiConst";
import TranslationIcon from "@/assets/icons/translation.svg";
import useColors from "@/hooks/useColors";
import Toast from "@/utils/toast";
import { hidePanel, showPanel } from "@/components/panels/usePanel";
import TrackPlayer from "@/core/trackPlayer";
import PersistStatus from "@/utils/persistStatus";
import useOrientation from "@/hooks/useOrientation";
import HeartIcon from "../heartIcon";
import Icon from "@/components/base/icon.tsx";
import lyricManager, { useLyricState } from "@/core/lyricManager";
import { useI18N } from "@/core/i18n";
import { PORTRAIT_GESTURE_EXTENSION } from "../../bottom/layout";

interface ILyricOperationsProps {
    scrollToCurrentLrcItem: () => void;
}

export default function LyricOperations(props: ILyricOperationsProps) {
    const { scrollToCurrentLrcItem } = props;

    const detailFontSize = PersistStatus.useValue("lyric.detailFontSize", 1);
    const detailAlign = PersistStatus.useValue("lyric.detailAlign", "center");
    const isAmlLiteMode = PersistStatus.useValue(
        "lyric.detailAmlLiteMode",
        false,
    );

    const { hasTranslation, hasRomanization } = useLyricState();
    const showTranslation = PersistStatus.useValue(
        "lyric.showTranslation",
        false,
    );
    const showRomanization = PersistStatus.useValue(
        "lyric.showRomanization",
        false,
    );
    const colors = useColors();
    const orientation = useOrientation();
    const { t } = useI18N();

    return (
        <View
            style={[
                styles.container,
                orientation === "vertical"
                    ? styles.verticalContainer
                    : null,
            ]}>
            {orientation === "vertical" ? <HeartIcon /> : null}
            <Icon
                name="lyric"
                size={iconSizeConst.normal}
                opacity={isAmlLiteMode ? 1 : 0.55}
                color={isAmlLiteMode ? colors.primary : "white"}
                onPress={() => {
                    PersistStatus.set(
                        "lyric.detailAmlLiteMode",
                        !isAmlLiteMode,
                    );
                    scrollToCurrentLrcItem();
                }}
            />
            <Icon
                name="font-size"
                size={iconSizeConst.normal}
                color="white"
                onPress={() => {
                    showPanel("SetFontSize", {
                        defaultSelect: detailFontSize ?? 1,
                        onSelectChange(value) {
                            PersistStatus.set("lyric.detailFontSize", value);
                            scrollToCurrentLrcItem();
                        },
                    });
                }}
            />
            <Icon
                name="bars-3"
                size={iconSizeConst.normal}
                color={detailAlign === "center" ? "white" : colors.primary}
                onPress={() => {
                    showPanel("SimpleSelect", {
                        header: t("basicSettings.lyric.align"),
                        height: rpx(420),
                        candidates: [
                            {
                                title: t("basicSettings.lyric.align.left"),
                                icon: "bars-3",
                                value: "left",
                            },
                            {
                                title: t("basicSettings.lyric.align.center"),
                                icon: "bars-3",
                                value: "center",
                            },
                            {
                                title: t("basicSettings.lyric.align.right"),
                                icon: "bars-3",
                                value: "right",
                            },
                        ],
                        onPress(item) {
                            PersistStatus.set(
                                "lyric.detailAlign",
                                item.value as "left" | "center" | "right",
                            );
                            scrollToCurrentLrcItem();
                            hidePanel();
                        },
                    });
                }}
            />
            <Icon
                name="arrows-left-right"
                size={iconSizeConst.normal}
                color="white"
                onPress={() => {
                    const currentMusicItem = TrackPlayer.currentMusic;

                    if (currentMusicItem) {
                        showPanel("SetLyricOffset", {
                            musicItem: currentMusicItem,
                            onPreview(offset) {
                                lyricManager.updateLyricOffset(
                                    currentMusicItem,
                                    offset,
                                );
                                scrollToCurrentLrcItem();
                            },
                            onSubmit(offset) {
                                lyricManager.updateLyricOffset(
                                    currentMusicItem,
                                    offset,
                                );
                                scrollToCurrentLrcItem();
                                hidePanel();
                            },
                        });
                    }
                }}
            />

            <Icon
                name="magnifying-glass"
                size={iconSizeConst.normal}
                color="white"
                onPress={() => {
                    const currentMusic = TrackPlayer.currentMusic;
                    if (!currentMusic) {
                        return;
                    }
                    // if (
                    //     Config.get('setting.basic.associateLyricType') ===
                    //     'input'
                    // ) {
                    //     showPanel('AssociateLrc', {
                    //         musicItem: currentMusic,
                    //     });
                    // } else {
                    showPanel("SearchLrc", {
                        musicItem: currentMusic,
                    });
                    // }
                }}
            />
            <TranslationIcon
                width={iconSizeConst.normal}
                height={iconSizeConst.normal}
                opacity={!hasTranslation ? 0.2 : showTranslation ? 1 : 0.5}
                color={
                    showTranslation && hasTranslation ? colors.primary : "white"
                }
                // style={}
                onPress={() => {
                    if (!hasTranslation) {
                        Toast.warn(t("lyric.noTranslation"));
                        return;
                    }

                    PersistStatus.set(
                        "lyric.showTranslation",
                        !showTranslation,
                    );
                    scrollToCurrentLrcItem();
                }}
            />
            <Icon
                name="language"
                size={iconSizeConst.normal}
                opacity={!hasRomanization ? 0.2 : showRomanization ? 1 : 0.5}
                color={
                    showRomanization && hasRomanization
                        ? colors.primary
                        : "white"
                }
                onPress={() => {
                    if (!hasRomanization) {
                        Toast.warn(t("lyric.noRomanization"));
                        return;
                    }

                    PersistStatus.set(
                        "lyric.showRomanization",
                        !showRomanization,
                    );
                    scrollToCurrentLrcItem();
                }}
            />
            <Icon
                name="ellipsis-vertical"
                size={iconSizeConst.normal}
                color={"white"}
                onPress={() => {
                    const currentMusic = TrackPlayer.currentMusic;
                    if (currentMusic) {
                        showPanel("MusicItemLyricOptions", {
                            musicItem: currentMusic,
                        });
                    }
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        height: rpx(80),
        marginBottom: rpx(24),
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-around",
    },
    verticalContainer: {
        marginBottom: rpx(24 + PORTRAIT_GESTURE_EXTENSION),
    },
});

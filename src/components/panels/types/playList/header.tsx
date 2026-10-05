import ThemeText from "@/components/base/themeText";
import { MusicRepeatModeInfo } from "@/constants/trackPlayerConst";
import { useI18N } from "@/core/i18n";
import TrackPlayer, {
    usePlayLaterQueue,
    usePlayList,
    useRepeatMode,
} from "@/core/trackPlayer";
import Icon from "@/components/base/icon";
import useColors from "@/hooks/useColors";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

export default function Header() {
    const repeatMode = useRepeatMode();
    const playList = usePlayList();
    const playLaterQueue = usePlayLaterQueue();
    const colors = useColors();
    const { t } = useI18N();

    return (
        <View style={styles.wrapper}>
            <ThemeText
                accessibilityRole="header"
                style={styles.headerText}
                fontWeight="bold">
                {t("panel.playList.title")}
                <ThemeText fontSize="subTitle" fontColor="textSecondary">
                    {t("panel.playList.count", {
                        count: playList.length + playLaterQueue.length,
                    })}
                </ThemeText>
            </ThemeText>
            <View style={styles.actions}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(("repeatMode." + repeatMode) as any)}
                    style={styles.button}
                    onPress={() => TrackPlayer.toggleRepeatMode()}>
                    <Icon name={MusicRepeatModeInfo[repeatMode].icon} color={colors.text} size={20} />
                    <ThemeText style={styles.buttonText} fontSize="description">
                        {t(("repeatMode." + repeatMode) as any)}
                    </ThemeText>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("common.clear")}
                    style={styles.button}
                    onPress={() => {
                        TrackPlayer.clearQueueWithUndo();
                    }}>
                    <Icon name="trash-outline" color={colors.text} size={20} />
                    <ThemeText style={styles.buttonText} fontSize="description">
                        {t("common.clear")}
                    </ThemeText>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 6,
    },
    headerText: {
        fontSize: 20,
    },
    actions: {
        flexDirection: "row",
        justifyContent: "space-between",
        flexWrap: "wrap",
    },
    button: {
        minHeight: 44,
        minWidth: 44,
        maxWidth: "100%",
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 6,
    },
    buttonText: {
        flexShrink: 1,
        marginLeft: 6,
    },
});

import IconTextButton from "@/components/base/iconTextButton";
import ThemeText from "@/components/base/themeText";
import { MusicRepeatModeInfo } from "@/constants/trackPlayerConst";
import { useI18N } from "@/core/i18n";
import TrackPlayer, {
    usePlayLaterQueue,
    usePlayList,
    useRepeatMode,
} from "@/core/trackPlayer";
import delay from "@/utils/delay";
import rpx from "@/utils/rpx";
import React from "react";
import { InteractionManager, StyleSheet, View } from "react-native";

export default function Header() {
    const repeatMode = useRepeatMode();
    const playList = usePlayList();
    const playLaterQueue = usePlayLaterQueue();
    const { t } = useI18N();

    return (
        <View style={style.wrapper}>
            <ThemeText
                accessibilityRole="header"
                style={style.headerText}
                fontWeight="bold">
                {t("panel.playList.title")}
                <ThemeText fontSize="subTitle" fontColor="textSecondary">
                    {t("panel.playList.count", {
                        count: playList.length + playLaterQueue.length,
                    })}
                </ThemeText>
            </ThemeText>
            <IconTextButton
                onPress={() => {
                    InteractionManager.runAfterInteractions(async () => {
                        await delay(20, false);
                        TrackPlayer.toggleRepeatMode();
                    });
                }}
                icon={MusicRepeatModeInfo[repeatMode].icon}>
                {t(("repeatMode." + repeatMode) as any)}
            </IconTextButton>
            <IconTextButton
                icon="trash-outline"
                onPress={() => {
                    TrackPlayer.clearPlayList();
                }}>
                {t("common.clear")}
            </IconTextButton>
        </View>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: rpx(750),
        height: 48,
        paddingLeft: 20,
        paddingRight: 12,
        marginTop: 18,
        marginBottom: 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    headerText: {
        flex: 1,
        fontSize: 20,
        lineHeight: 25,
    },
});

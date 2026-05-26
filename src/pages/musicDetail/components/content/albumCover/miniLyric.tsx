import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fontSizeConst, fontWeightConst } from "@/constants/uiConst";
import { useI18N } from "@/core/i18n";
import { useCurrentLyricItem, useLyricState } from "@/core/lyricManager";
import PersistStatus from "@/utils/persistStatus";
import rpx from "@/utils/rpx";
import { getCoverLeftMargin } from "./index";

interface IMiniLyricProps {
    compact?: boolean;
    onPress?: () => void;
}

export default function MiniLyric(props: IMiniLyricProps) {
    const { compact = false, onPress } = props;
    const { t } = useI18N();
    const lyricState = useLyricState();
    const currentLyricItem = useCurrentLyricItem();
    const showTranslation = PersistStatus.useValue(
        "lyric.showTranslation",
        false,
    );

    const secondaryLine = useMemo(() => {
        if (showTranslation && currentLyricItem?.translation) {
            return currentLyricItem.translation;
        }
        return currentLyricItem?.romanization;
    }, [currentLyricItem, showTranslation]);

    const primaryLine = useMemo(() => {
        if (lyricState.loading) {
            return t("common.loading");
        }
        if (!lyricState.lyrics.length) {
            return t("lyric.noLyric");
        }
        return currentLyricItem?.lrc?.trim() ? currentLyricItem.lrc : " ";
    }, [currentLyricItem, lyricState.loading, lyricState.lyrics.length, t]);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.container,
                compact ? styles.compactContainer : null,
                pressed ? styles.pressed : null,
            ]}>
            <View style={styles.inner}>
                <Text
                    numberOfLines={compact ? 1 : 2}
                    style={[styles.primary, compact ? styles.compactPrimary : null]}>
                    {primaryLine}
                </Text>
                {!compact && secondaryLine ? (
                    <Text numberOfLines={1} style={styles.secondary}>
                        {secondaryLine}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        width: "100%",
        paddingHorizontal: getCoverLeftMargin(),
        marginTop: rpx(2),
        marginBottom: rpx(10),
    },
    compactContainer: {
        marginBottom: rpx(4),
    },
    inner: {
        width: "100%",
        minHeight: rpx(76),
        justifyContent: "center",
        alignItems: "center",
    },
    primary: {
        width: "100%",
        color: "white",
        fontSize: fontSizeConst.content,
        fontWeight: fontWeightConst.medium,
        includeFontPadding: false,
        lineHeight: rpx(40),
        textAlign: "center",
    },
    compactPrimary: {
        fontSize: fontSizeConst.subTitle,
    },
    secondary: {
        width: "100%",
        color: "rgba(255, 255, 255, 0.72)",
        fontSize: fontSizeConst.description,
        includeFontPadding: false,
        lineHeight: rpx(32),
        marginTop: rpx(10),
        textAlign: "center",
    },
    pressed: {
        opacity: 0.65,
    },
});

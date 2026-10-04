import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import timeformat from "@/utils/timeformat";
import { fontWeightConst, maxFontScaleConst } from "@/constants/uiConst";
import TrackPlayer, {
    useCurrentMusic,
    useMusicQuality,
    useProgress,
} from "@/core/trackPlayer";
import i18n, { useI18N } from "@/core/i18n";
import { showPanel } from "@/components/panels/usePanel";
import { getQualityAbbr } from "@/utils/qualities";
import Toast from "@/utils/toast";
import PersistStatus from "@/utils/persistStatus";
import { getMediaSourceFailureI18nKey } from "@/core/pluginManager/mediaSourceFailure";

/** 100 → "1.0x"，125 → "1.25x" */
export function formatPlayRate(rate: number) {
    const value = rate / 100;
    return `${value.toFixed(rate % 10 === 0 ? 1 : 2)}x`;
}

/** 进度条下方中间的小标签：点音质切换音质，点倍速切换倍速 */
function Badge(props: {
    label: string;
    accessibilityLabel: string;
    onPress: () => void;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel}
            hitSlop={8}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.badge,
                pressed ? styles.pressed : null,
            ]}>
            <Text
                maxFontSizeMultiplier={maxFontScaleConst.compact}
                style={styles.badgeText}>
                {props.label}
            </Text>
        </Pressable>
    );
}

function QualityBadge() {
    const musicItem = useCurrentMusic();
    const currentQuality = useMusicQuality();
    const { t } = useI18N();
    const label = getQualityAbbr(currentQuality) || "HQ";

    return (
        <Badge
            label={label}
            accessibilityLabel={t("musicDetail.quality.a11y", {
                quality: label,
            })}
            onPress={() => {
                if (!musicItem) {
                    return;
                }
                showPanel("MusicQuality", {
                    musicItem,
                    async onQualityPress(quality) {
                        const changeResult =
                            await TrackPlayer.changeQualityWithResult(quality);
                        if (!changeResult.success && !changeResult.superseded) {
                            Toast.warn(
                                i18n.t(
                                    changeResult.failure
                                        ? getMediaSourceFailureI18nKey(
                                            changeResult.failure.code,
                                        )
                                        : "toast.currentQualityNotAvailableForCurrentMusic",
                                ),
                            );
                        }
                    },
                });
            }}
        />
    );
}

function RateBadge() {
    const rate = PersistStatus.useValue("music.rate", 100) ?? 100;
    const { t } = useI18N();
    const label = formatPlayRate(rate);

    return (
        <Badge
            label={label}
            accessibilityLabel={t("musicDetail.rate.a11y", { rate: label })}
            onPress={() => {
                showPanel("PlayRate", {
                    async onRatePress(newRate) {
                        if (rate !== newRate) {
                            try {
                                await TrackPlayer.setRate(newRate / 100);
                                PersistStatus.set("music.rate", newRate);
                            } catch {}
                        }
                    },
                });
            }}
        />
    );
}

/** iOS 播放页进度条：细轨道，下面左右是已播放与剩余时间 */
export default function SeekBar() {
    const progress = useProgress(1000);
    const musicItem = useCurrentMusic();
    const { t } = useI18N();
    const [tmpProgress, setTmpProgress] = useState<number | null>(null);
    const slidingRef = useRef(false);
    const displayDuration =
        progress.duration > 0 ? progress.duration : musicItem?.duration ?? 0;
    const position = tmpProgress ?? progress.position;

    return (
        <View style={styles.wrapper}>
            <Slider
                style={styles.slider}
                accessibilityLabel={t("musicDetail.seekBar.a11y")}
                minimumTrackTintColor="#FFFFFF"
                maximumTrackTintColor="rgba(255, 255, 255, 0.3)"
                thumbTintColor="#FFFFFF"
                minimumValue={0}
                maximumValue={displayDuration}
                onSlidingStart={() => {
                    slidingRef.current = true;
                }}
                onValueChange={val => {
                    if (slidingRef.current) {
                        setTmpProgress(val);
                    }
                }}
                onSlidingComplete={val => {
                    slidingRef.current = false;
                    setTmpProgress(null);
                    if (val >= displayDuration - 2) {
                        val = displayDuration - 2;
                    }
                    TrackPlayer.seekTo(val);
                }}
                value={progress.position}
            />
            <View style={styles.timeRow}>
                <Text
                    maxFontSizeMultiplier={maxFontScaleConst.compact}
                    style={[styles.time, styles.timeStart]}>
                    {timeformat(Math.max(position, 0))}
                </Text>
                <View style={styles.badges}>
                    <QualityBadge />
                    <RateBadge />
                </View>
                <Text
                    maxFontSizeMultiplier={maxFontScaleConst.compact}
                    style={[styles.time, styles.timeEnd]}>
                    {`-${timeformat(Math.max(displayDuration - position, 0))}`}
                </Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        paddingHorizontal: 30,
    },
    slider: {
        height: 32,
        // 安卓的滑块两端自带内边距，往外扩一点让轨道和时间文字对齐
        marginHorizontal: -12,
    },
    timeRow: {
        flexDirection: "row",
        alignItems: "center",
        marginTop: 2,
    },
    time: {
        flex: 1,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: fontWeightConst.semibold,
        color: "rgba(255, 255, 255, 0.66)",
        includeFontPadding: false,
        fontVariant: ["tabular-nums"],
    },
    timeStart: {
        textAlign: "left",
    },
    timeEnd: {
        textAlign: "right",
    },
    badges: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    badge: {
        height: 22,
        paddingHorizontal: 8,
        borderRadius: 6,
        justifyContent: "center",
        backgroundColor: "rgba(255, 255, 255, 0.16)",
    },
    badgeText: {
        color: "rgba(255, 255, 255, 0.92)",
        fontSize: 11,
        fontWeight: fontWeightConst.bold,
        letterSpacing: 0.4,
        includeFontPadding: false,
    },
    pressed: {
        opacity: 0.6,
    },
});

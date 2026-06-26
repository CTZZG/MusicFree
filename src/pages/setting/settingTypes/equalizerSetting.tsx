import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Slider from "@react-native-community/slider";
import rpx from "@/utils/rpx";
import ThemeText from "@/components/base/themeText";
import ThemeSwitch from "@/components/base/switch";
import useColors from "@/hooks/useColors";
import Equalizer, {
    CUSTOM_PRESET_ID,
    EQUALIZER_BANDS,
    EQUALIZER_GAIN,
    EQUALIZER_PRESETS,
    useEqualizerEnabled,
    useEqualizerGains,
    useEqualizerPreset,
} from "@/core/equalizer";

function formatGain(gain: number) {
    return `${gain > 0 ? "+" : ""}${gain}dB`;
}

export default function EqualizerSetting() {
    const colors = useColors();
    const enabled = useEqualizerEnabled();
    const preset = useEqualizerPreset();
    const gains = useEqualizerGains();

    return (
        <ScrollView
            style={styles.wrapper}
            contentContainerStyle={styles.content}>
            <View style={styles.headerRow}>
                <View style={styles.headerText}>
                    <ThemeText fontSize="title" fontWeight="bold">
                        均衡器
                    </ThemeText>
                    <ThemeText
                        fontSize="description"
                        fontColor="textSecondary"
                        style={styles.hint}>
                        需要音频引擎支持，接入后调节将实时生效
                    </ThemeText>
                </View>
                <ThemeSwitch
                    value={enabled}
                    onValueChange={value => Equalizer.setEnabled(value)}
                />
            </View>

            <View style={[styles.section, !enabled && styles.disabledSection]}>
                <ThemeText
                    fontSize="subTitle"
                    fontWeight="semibold"
                    style={styles.sectionTitle}>
                    预设
                </ThemeText>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.presetRow}>
                    {EQUALIZER_PRESETS.map(item => {
                        const active = preset === item.id;
                        return (
                            <Pressable
                                key={item.id}
                                disabled={!enabled}
                                onPress={() => Equalizer.selectPreset(item.id)}
                                style={[
                                    styles.presetChip,
                                    {
                                        backgroundColor: active
                                            ? colors.primary
                                            : colors.placeholder ??
                                              "rgba(128,128,128,0.2)",
                                    },
                                ]}>
                                <ThemeText
                                    fontSize="subTitle"
                                    color={active ? "#fff" : colors.text}>
                                    {item.label}
                                </ThemeText>
                            </Pressable>
                        );
                    })}
                    {preset === CUSTOM_PRESET_ID ? (
                        <View
                            style={[
                                styles.presetChip,
                                { backgroundColor: colors.primary },
                            ]}>
                            <ThemeText fontSize="subTitle" color="#fff">
                                自定义
                            </ThemeText>
                        </View>
                    ) : null}
                </ScrollView>
            </View>

            <View style={[styles.section, !enabled && styles.disabledSection]}>
                <ThemeText
                    fontSize="subTitle"
                    fontWeight="semibold"
                    style={styles.sectionTitle}>
                    频段
                </ThemeText>
                {EQUALIZER_BANDS.map((band, index) => (
                    <View key={band.freq} style={styles.bandRow}>
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary"
                            style={styles.bandLabel}>
                            {band.label}
                        </ThemeText>
                        <Slider
                            style={styles.slider}
                            disabled={!enabled}
                            minimumValue={EQUALIZER_GAIN.min}
                            maximumValue={EQUALIZER_GAIN.max}
                            step={EQUALIZER_GAIN.step}
                            value={gains[index] ?? 0}
                            minimumTrackTintColor={colors.primary}
                            maximumTrackTintColor={
                                colors.placeholder ?? "rgba(128,128,128,0.3)"
                            }
                            thumbTintColor={colors.primary}
                            onValueChange={value =>
                                Equalizer.setBandGain(index, value)
                            }
                        />
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary"
                            style={styles.bandGain}>
                            {formatGain(gains[index] ?? 0)}
                        </ThemeText>
                    </View>
                ))}
            </View>

            <Pressable
                disabled={!enabled}
                onPress={() => Equalizer.reset()}
                style={[
                    styles.resetButton,
                    !enabled && styles.disabledSection,
                    { borderColor: colors.divider ?? "rgba(128,128,128,0.3)" },
                ]}>
                <ThemeText fontColor="textSecondary">重置</ThemeText>
            </Pressable>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        flex: 1,
    },
    content: {
        padding: rpx(24),
        paddingBottom: rpx(72),
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: rpx(16),
    },
    headerText: {
        flex: 1,
        marginRight: rpx(24),
    },
    hint: {
        marginTop: rpx(8),
    },
    section: {
        marginTop: rpx(40),
    },
    disabledSection: {
        opacity: 0.4,
    },
    sectionTitle: {
        marginBottom: rpx(20),
    },
    presetRow: {
        gap: rpx(16),
        paddingRight: rpx(24),
    },
    presetChip: {
        paddingHorizontal: rpx(28),
        paddingVertical: rpx(14),
        borderRadius: rpx(32),
        justifyContent: "center",
        alignItems: "center",
    },
    bandRow: {
        flexDirection: "row",
        alignItems: "center",
        height: rpx(80),
    },
    bandLabel: {
        width: rpx(80),
    },
    slider: {
        flex: 1,
        marginHorizontal: rpx(12),
    },
    bandGain: {
        width: rpx(96),
        textAlign: "right",
    },
    resetButton: {
        marginTop: rpx(56),
        alignSelf: "center",
        paddingHorizontal: rpx(64),
        paddingVertical: rpx(20),
        borderRadius: rpx(36),
        borderWidth: 1,
    },
});

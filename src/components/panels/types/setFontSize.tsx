import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";
import { vh } from "@/utils/rpx";
import ThemeText from "@/components/base/themeText";
import useColors from "@/hooks/useColors";
import { useI18N } from "@/core/i18n";
import {
    DEFAULT_DETAIL_LYRIC_FONT_SIZE_INDEX,
    DETAIL_LYRIC_FONT_SIZES,
    getDetailLyricFontSize,
    normalizeDetailLyricFontSizeIndex,
} from "@/utils/detailLyricFontSize";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";

interface IProps {
    defaultSelect?: number;
    /** 选择后立即应用，与详情页歌词字号共用档位。 */
    onSelectChange: (value: number) => void;
}

export default function SetFontSize(props: IProps) {
    const { defaultSelect, onSelectChange } = props;
    const colors = useColors();
    const { t } = useI18N();
    const insets = useSafeAreaInsets();
    const [selected, setSelected] = useState(() =>
        normalizeDetailLyricFontSizeIndex(defaultSelect),
    );
    const options = [
        t("panel.setFontSize.small"),
        t("panel.setFontSize.standard"),
        t("panel.setFontSize.large"),
        t("panel.setFontSize.extraLarge"),
        ...DETAIL_LYRIC_FONT_SIZES.slice(4).map(size => `${size / 30}×`),
    ];
    const selectSize = (value: number) => {
        const next = normalizeDetailLyricFontSizeIndex(value);
        setSelected(next);
        onSelectChange(next);
    };

    return (
        <PanelBase
            height={vh(65)}
            keyboardAvoidBehavior="none"
            renderBody={() => (
                <>
                    <PanelHeader title={t("panel.setFontSize.title")} hideButtons />
                    <ScrollView
                        style={styles.scroll}
                        contentContainerStyle={[
                            styles.content,
                            { paddingBottom: insets.bottom + 16 },
                        ]}>
                        <ThemeText fontColor="textSecondary">
                            {t("panel.setFontSize.description")}
                        </ThemeText>
                        <View style={styles.preview}>
                            <ThemeText fontSize="description" fontColor="textSecondary">
                                {t("panel.setFontSize.previewLabel")}
                            </ThemeText>
                            <ThemeText
                                allowFontScaling={false}
                                style={[
                                    styles.previewText,
                                    { fontSize: getDetailLyricFontSize(selected) },
                                ]}>
                                {t("panel.setFontSize.preview")}
                            </ThemeText>
                        </View>
                        <Slider
                            style={styles.slider}
                            accessibilityLabel={t("panel.setFontSize.sliderLabel")}
                            accessibilityValue={{
                                min: 0,
                                max: options.length - 1,
                                now: selected,
                                text: options[selected],
                            }}
                            thumbTintColor={colors.primary}
                            minimumTrackTintColor={colors.primary}
                            value={selected}
                            step={1}
                            minimumValue={0}
                            maximumValue={options.length - 1}
                            onValueChange={selectSize}
                        />
                        <View style={styles.options}>
                            {options.map((label, index) => (
                                <Pressable
                                    key={label}
                                    accessibilityRole="radio"
                                    accessibilityLabel={label}
                                    accessibilityState={{ checked: selected === index }}
                                    onPress={() => selectSize(index)}
                                    style={[
                                        styles.option,
                                        { borderColor: selected === index ? colors.primary : colors.divider },
                                    ]}>
                                    <ThemeText
                                        style={styles.optionText}
                                        fontColor={selected === index ? "primary" : "text"}>
                                        {label}
                                    </ThemeText>
                                </Pressable>
                            ))}
                        </View>
                        <Pressable
                            accessibilityRole="button"
                            onPress={() => selectSize(DEFAULT_DETAIL_LYRIC_FONT_SIZE_INDEX)}
                            style={styles.reset}>
                            <ThemeText style={styles.optionText} fontColor="primary">
                                {t("panel.setFontSize.reset")}
                            </ThemeText>
                        </Pressable>
                    </ScrollView>
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    scroll: {
        flex: 1,
    },
    content: {
        paddingTop: 16,
        paddingHorizontal: 16,
        gap: 16,
    },
    preview: {
        gap: 12,
    },
    previewText: {
        textAlign: "center",
        fontWeight: "700",
    },
    slider: {
        height: 44,
    },
    options: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    option: {
        width: "48%",
        minHeight: 44,
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        justifyContent: "center",
    },
    optionText: {
        textAlign: "center",
    },
    reset: {
        minHeight: 44,
        paddingVertical: 10,
        paddingHorizontal: 12,
        justifyContent: "center",
    },
});

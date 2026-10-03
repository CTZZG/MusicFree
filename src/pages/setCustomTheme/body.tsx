import { GroupedRow, GroupedSection } from "@/components/base/groupedList";
import Icon from "@/components/base/icon";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import pathConst from "@/constants/pathConst";
import { useI18N } from "@/core/i18n";
import Theme from "@/core/theme";
import useColors from "@/hooks/useColors";
import Toast from "@/utils/toast";
import Slider from "@react-native-community/slider";
import React, { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { copyFile } from "react-native-fs";
import { launchImageLibrary } from "react-native-image-picker";

const DEFAULT_BLUR = 20;
const DEFAULT_OPACITY = 0.6;

/** 取图片扩展名；content:// 之类没有扩展名的地址按 jpg 处理 */
function imageExtension(fileName: string | undefined, uri: string) {
    const match = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(fileName ?? uri);
    return match ? `.${match[1].toLowerCase()}` : ".jpg";
}

/** 首页背景图片：选图、调模糊与透明度，预览即首页的效果 */
export default function Body() {
    const { t } = useI18N();
    const colors = useColors();
    const background = Theme.useBackground();
    const url = background?.url;

    // 拖动滑块时只更新预览，松手再写入配置
    const [blur, setBlur] = useState(background?.blur ?? DEFAULT_BLUR);
    const [opacity, setOpacity] = useState(
        background?.opacity ?? DEFAULT_OPACITY,
    );
    useEffect(() => {
        setBlur(background?.blur ?? DEFAULT_BLUR);
        setOpacity(background?.opacity ?? DEFAULT_OPACITY);
    }, [background?.blur, background?.opacity]);

    async function pickImage() {
        try {
            const result = await launchImageLibrary({
                mediaType: "photo",
            });
            const asset = result.assets?.[0];
            if (!asset?.uri) {
                return;
            }
            const bgPath = `${pathConst.dataPath}background${imageExtension(
                asset.fileName,
                asset.uri,
            )}`;
            await copyFile(asset.uri, bgPath);
            // 文件名不变，加时间戳让图片缓存失效
            Theme.setBackground({
                url: `file://${bgPath}#${Date.now()}`,
            });
        } catch (e: any) {
            Toast.warn(e?.message ?? t("toast.unknownError"));
        }
    }

    function removeImage() {
        showDialog("SimpleDialog", {
            title: t("themeSettings.removeCustomBackground"),
            content: t("themeSettings.removeCustomBackground.confirm"),
            onOk() {
                Theme.clearBackground();
                Toast.success(t("themeSettings.removeCustomBackground.success"));
            },
        });
    }

    return (
        <ScrollView contentContainerStyle={styles.content}>
            <Pressable
                onPress={pickImage}
                accessibilityRole="button"
                accessibilityLabel={t("themeSettings.homeBackground.choose")}
                style={[
                    styles.preview,
                    {
                        backgroundColor: colors.pageBackground,
                        borderColor: colors.divider,
                    },
                ]}>
                {url ? (
                    <Image
                        source={{ uri: url }}
                        blurRadius={blur}
                        style={[StyleSheet.absoluteFill, { opacity }]}
                        resizeMode="cover"
                    />
                ) : (
                    <View style={styles.previewEmpty}>
                        <Icon name="photo" size={36} color={colors.primary} />
                        <ThemeText
                            fontSize="description"
                            fontColor="textSecondary"
                            style={styles.previewHint}>
                            {t("themeSettings.homeBackground.choose")}
                        </ThemeText>
                    </View>
                )}
            </Pressable>

            <GroupedSection footer={t("themeSettings.homeBackground.footer")}>
                <GroupedRow
                    title={t("themeSettings.homeBackground.choose")}
                    accessory="chevron"
                    onPress={pickImage}
                />
                {url ? (
                    <GroupedRow
                        title={t("themeSettings.removeCustomBackground")}
                        destructive
                        onPress={removeImage}
                    />
                ) : null}
            </GroupedSection>

            {url ? (
                <GroupedSection>
                    <View style={styles.sliderRow}>
                        <View style={styles.sliderLabel}>
                            <ThemeText>{t("setCustomTheme.blur")}</ThemeText>
                            <ThemeText fontColor="textSecondary">
                                {Math.round(blur)}
                            </ThemeText>
                        </View>
                        <Slider
                            style={styles.slider}
                            accessibilityLabel={t("setCustomTheme.blur")}
                            minimumTrackTintColor={colors.primary}
                            maximumTrackTintColor={colors.textSecondary}
                            thumbTintColor={colors.primary}
                            minimumValue={0}
                            maximumValue={30}
                            step={1}
                            value={blur}
                            onValueChange={setBlur}
                            onSlidingComplete={value => {
                                Theme.setBackground({ blur: value });
                            }}
                        />
                    </View>
                    <View style={styles.sliderRow}>
                        <View style={styles.sliderLabel}>
                            <ThemeText>{t("setCustomTheme.opacity")}</ThemeText>
                            <ThemeText fontColor="textSecondary">
                                {`${Math.round(opacity * 100)}%`}
                            </ThemeText>
                        </View>
                        <Slider
                            style={styles.slider}
                            accessibilityLabel={t("setCustomTheme.opacity")}
                            minimumTrackTintColor={colors.primary}
                            maximumTrackTintColor={colors.textSecondary}
                            thumbTintColor={colors.primary}
                            minimumValue={0.3}
                            maximumValue={1}
                            step={0.01}
                            value={opacity}
                            onValueChange={setOpacity}
                            onSlidingComplete={value => {
                                Theme.setBackground({ opacity: value });
                            }}
                        />
                    </View>
                </GroupedSection>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    content: {
        paddingTop: 16,
        paddingBottom: 32,
    },
    preview: {
        alignSelf: "center",
        width: 180,
        height: 320,
        borderRadius: 22,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: "hidden",
    },
    previewEmpty: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 16,
    },
    previewHint: {
        marginTop: 10,
        textAlign: "center",
    },
    sliderRow: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 6,
    },
    sliderLabel: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    slider: {
        height: 40,
        marginHorizontal: -8,
    },
});

import Icon from "@/components/base/icon";
import ListItem from "@/components/base/listItem";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import useColors from "@/hooks/useColors";
import rpx, { vmax } from "@/utils/rpx";
import Toast from "@/utils/toast";
import {
    BUILTIN_QUALITY_KEYS,
    builtinQualityAbbr,
    convertLegacyQuality,
    getQualityAbbr,
    getQualityKeys,
    getQualityText,
    qualityText,
} from "@/utils/qualities";
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Pressable, ScrollView, TextInput } from "react-native-gesture-handler";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { hidePanel } from "../usePanel";

function normalizeQualityKey(value: string) {
    return value.trim().toLowerCase();
}

export default function QualityTranslation() {
    const { t, getLanguage } = useI18N();
    const colors = useColors();
    const languageData = getLanguage().languageData;
    const defaultQualityText = useMemo(
        () => getQualityText(languageData),
        [languageData],
    );

    const savedTranslations = useAppConfig("basic.qualityTranslations");
    const savedAbbreviations = useAppConfig("basic.qualityAbbreviations");

    const [newKey, setNewKey] = useState("");
    const [keysList, setKeysList] = useState<string[]>(() => [
        ...getQualityKeys(),
    ]);
    const [translations, setTranslations] = useState<Record<string, string>>(
        () => {
            const initial: Record<string, string> = {};
            for (const key of getQualityKeys()) {
                initial[key] =
                    savedTranslations?.[key] ||
                    defaultQualityText[key] ||
                    key.toUpperCase();
            }
            return initial;
        },
    );
    const [abbreviations, setAbbreviations] = useState<Record<string, string>>(
        () => {
            const initial: Record<string, string> = {};
            for (const key of getQualityKeys()) {
                initial[key] =
                    savedAbbreviations?.[key] || getQualityAbbr(key);
            }
            return initial;
        },
    );

    const handleSave = () => {
        if (keysList.length === 0) {
            Toast.warn(t("panel.qualityTranslation.emptyList"));
            return;
        }
        Config.setConfig("basic.qualityKeysList", keysList);
        Config.setConfig("basic.qualityTranslations", translations);
        Config.setConfig("basic.qualityAbbreviations", abbreviations);
        Toast.success(t("panel.qualityTranslation.saveSuccess"));
        hidePanel();
    };

    const handleReset = () => {
        showDialog("SimpleDialog", {
            title: t("panel.qualityTranslation.resetTitle"),
            content: t("panel.qualityTranslation.resetContent"),
            onOk() {
                const builtinKeys = [...BUILTIN_QUALITY_KEYS];
                const resetTranslations: Record<string, string> = {};
                const resetAbbreviations: Record<string, string> = {};
                for (const key of builtinKeys) {
                    resetTranslations[key] =
                        (languageData as any)[`quality.${key}`] ||
                        (languageData as any)[`musicQuality.${key}`] ||
                        qualityText[key] ||
                        key.toUpperCase();
                    resetAbbreviations[key] =
                        builtinQualityAbbr[key] ||
                        key.slice(0, 2).toUpperCase();
                }
                setKeysList(builtinKeys);
                setTranslations(resetTranslations);
                setAbbreviations(resetAbbreviations);
                Toast.success(t("panel.qualityTranslation.resetSuccess"));
            },
        });
    };

    const handleAdd = useCallback(() => {
        const key = normalizeQualityKey(newKey);
        if (!/^[a-z0-9_]+$/.test(key)) {
            Toast.warn(t("panel.qualityTranslation.addInvalid"));
            return;
        }
        const normalizedKey = convertLegacyQuality(key);
        const normalizedKeysList = keysList.map(convertLegacyQuality);
        if (normalizedKeysList.includes(normalizedKey)) {
            Toast.warn(
                t("panel.qualityTranslation.addDuplicate", {
                    key: normalizedKey,
                }),
            );
            return;
        }

        setKeysList(prev => [...prev, key]);
        setTranslations(prev => ({
            ...prev,
            [key]: key.toUpperCase(),
        }));
        setAbbreviations(prev => ({
            ...prev,
            [key]: key.slice(0, 2).toUpperCase(),
        }));
        setNewKey("");
    }, [keysList, newKey, t]);

    const handleDelete = useCallback(
        (key: string) => {
            const doDelete = () => {
                setKeysList(prev => prev.filter(item => item !== key));
                setTranslations(prev => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                });
                setAbbreviations(prev => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                });
                Toast.success(
                    t("panel.qualityTranslation.deleteSuccess", { key }),
                );
            };

            if (BUILTIN_QUALITY_KEYS.includes(key)) {
                showDialog("SimpleDialog", {
                    title: t("panel.qualityTranslation.deleteBuiltinTitle"),
                    content: t(
                        "panel.qualityTranslation.deleteBuiltinContent",
                        { key },
                    ),
                    onOk: doDelete,
                });
            } else {
                doDelete();
            }
        },
        [t],
    );

    const moveQuality = useCallback((index: number, delta: -1 | 1) => {
        setKeysList(prev => {
            const nextIndex = index + delta;
            if (nextIndex < 0 || nextIndex >= prev.length) {
                return prev;
            }
            const next = [...prev];
            [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
            return next;
        });
    }, []);

    return (
        <PanelBase
            keyboardAvoidBehavior="height"
            height={vmax(85)}
            renderBody={() => (
                <>
                    <PanelHeader
                        title={t("panel.qualityTranslation.title")}
                        onCancel={hidePanel}
                        onOk={handleSave}
                    />
                    <ScrollView
                        style={styles.scrollView}
                        keyboardShouldPersistTaps="handled">
                        <View style={styles.description}>
                            <ThemeText
                                fontSize="subTitle"
                                fontColor="textSecondary"
                                style={styles.descriptionText}>
                                {t("panel.qualityTranslation.description")}
                            </ThemeText>
                        </View>

                        <View style={styles.addRow}>
                            <TextInput
                                value={newKey}
                                onChangeText={setNewKey}
                                style={[
                                    styles.input,
                                    styles.addInput,
                                    {
                                        color: colors.text,
                                        backgroundColor: colors.placeholder,
                                    },
                                ]}
                                placeholder={t(
                                    "panel.qualityTranslation.customKeyPlaceholder",
                                )}
                                placeholderTextColor={colors.textSecondary}
                                maxLength={30}
                                autoCapitalize="none"
                                onSubmitEditing={handleAdd}
                            />
                            <Pressable
                                style={[
                                    styles.addButton,
                                    { backgroundColor: colors.primary },
                                ]}
                                onPress={handleAdd}>
                                <Icon name="plus" size={rpx(34)} color="#fff" />
                            </Pressable>
                        </View>

                        {keysList.map((qualityKey, index) => (
                            <View
                                key={qualityKey}
                                style={[
                                    styles.itemContainer,
                                    { borderBottomColor: colors.divider },
                                ]}>
                                <View style={styles.itemHeader}>
                                    <View style={styles.keyBadge}>
                                        <ThemeText
                                            fontSize="description"
                                            fontWeight="bold"
                                            style={styles.keyText}>
                                            {qualityKey}
                                        </ThemeText>
                                    </View>
                                    {BUILTIN_QUALITY_KEYS.includes(
                                        qualityKey,
                                    ) ? (
                                        <ThemeText
                                            fontSize="description"
                                            fontColor="textSecondary"
                                            style={styles.builtinTag}>
                                            {t(
                                                "panel.qualityTranslation.builtin",
                                            )}
                                        </ThemeText>
                                    ) : null}
                                    <View style={styles.itemActions}>
                                        <Pressable
                                            onPress={() =>
                                                moveQuality(index, -1)
                                            }
                                            style={styles.actionButton}
                                            hitSlop={8}>
                                            <ThemeText
                                                fontSize="content"
                                                fontColor={
                                                    index > 0
                                                        ? "text"
                                                        : "textSecondary"
                                                }>
                                                ▲
                                            </ThemeText>
                                        </Pressable>
                                        <Pressable
                                            onPress={() =>
                                                moveQuality(index, 1)
                                            }
                                            style={styles.actionButton}
                                            hitSlop={8}>
                                            <ThemeText
                                                fontSize="content"
                                                fontColor={
                                                    index <
                                                    keysList.length - 1
                                                        ? "text"
                                                        : "textSecondary"
                                                }>
                                                ▼
                                            </ThemeText>
                                        </Pressable>
                                        <Pressable
                                            onPress={() =>
                                                handleDelete(qualityKey)
                                            }
                                            style={styles.actionButton}
                                            hitSlop={8}>
                                            <Icon
                                                name="trash-outline"
                                                size={rpx(28)}
                                                color="#d64541"
                                            />
                                        </Pressable>
                                    </View>
                                </View>
                                <View style={styles.inputRow}>
                                    <View style={styles.inputGroup}>
                                        <ThemeText
                                            fontSize="description"
                                            fontColor="textSecondary"
                                            style={styles.inputLabel}>
                                            {t(
                                                "panel.qualityTranslation.labelLabel",
                                            )}
                                        </ThemeText>
                                        <TextInput
                                            value={
                                                translations[qualityKey] ?? ""
                                            }
                                            onChangeText={text => {
                                                setTranslations(prev => ({
                                                    ...prev,
                                                    [qualityKey]: text,
                                                }));
                                            }}
                                            style={[
                                                styles.input,
                                                {
                                                    color: colors.text,
                                                    backgroundColor:
                                                        colors.placeholder,
                                                },
                                            ]}
                                            placeholderTextColor={
                                                colors.textSecondary
                                            }
                                            placeholder={qualityKey.toUpperCase()}
                                            maxLength={50}
                                        />
                                    </View>
                                    <View style={styles.abbrGroup}>
                                        <ThemeText
                                            fontSize="description"
                                            fontColor="textSecondary"
                                            style={styles.inputLabel}>
                                            {t(
                                                "panel.qualityTranslation.abbrLabel",
                                            )}
                                        </ThemeText>
                                        <TextInput
                                            value={
                                                abbreviations[qualityKey] ?? ""
                                            }
                                            onChangeText={text => {
                                                setAbbreviations(prev => ({
                                                    ...prev,
                                                    [qualityKey]: text,
                                                }));
                                            }}
                                            style={[
                                                styles.input,
                                                {
                                                    color: colors.text,
                                                    backgroundColor:
                                                        colors.placeholder,
                                                },
                                            ]}
                                            placeholderTextColor={
                                                colors.textSecondary
                                            }
                                            placeholder={qualityKey
                                                .slice(0, 2)
                                                .toUpperCase()}
                                            maxLength={4}
                                        />
                                    </View>
                                </View>
                            </View>
                        ))}

                        <View style={styles.actionsContainer}>
                            <ListItem
                                withHorizontalPadding
                                heightType="small"
                                onPress={handleReset}>
                                <ListItem.ListItemIcon
                                    position="left"
                                    icon="arrow-path"
                                    color={colors.textSecondary}
                                />
                                <ListItem.Content
                                    title={t(
                                        "panel.qualityTranslation.resetDefault",
                                    )}
                                />
                            </ListItem>
                        </View>
                        <View style={styles.bottomPadding} />
                    </ScrollView>
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    scrollView: {
        flex: 1,
    },
    description: {
        paddingHorizontal: rpx(24),
        paddingTop: rpx(16),
        paddingBottom: rpx(8),
    },
    descriptionText: {
        lineHeight: rpx(36),
    },
    addRow: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(12),
        flexDirection: "row",
        alignItems: "center",
        gap: rpx(12),
    },
    addInput: {
        flex: 1,
    },
    addButton: {
        width: rpx(72),
        height: rpx(72),
        borderRadius: rpx(12),
        alignItems: "center",
        justifyContent: "center",
    },
    itemContainer: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(12),
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    itemHeader: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: rpx(8),
    },
    keyBadge: {
        paddingHorizontal: rpx(12),
        paddingVertical: rpx(4),
        borderRadius: rpx(8),
        backgroundColor: "rgba(100,100,100,0.15)",
    },
    keyText: {
        fontFamily: "monospace",
    },
    builtinTag: {
        marginLeft: rpx(10),
    },
    itemActions: {
        flexDirection: "row",
        alignItems: "center",
        marginLeft: "auto",
        gap: rpx(12),
    },
    actionButton: {
        padding: rpx(4),
    },
    inputRow: {
        flexDirection: "row",
        gap: rpx(12),
    },
    inputGroup: {
        flex: 1,
    },
    abbrGroup: {
        width: rpx(120),
    },
    inputLabel: {
        marginBottom: rpx(4),
    },
    input: {
        borderRadius: rpx(12),
        fontSize: rpx(28),
        lineHeight: rpx(42),
        padding: rpx(12),
        paddingHorizontal: rpx(16),
    },
    actionsContainer: {
        marginTop: rpx(16),
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: "#e0e0e0",
        paddingTop: rpx(8),
    },
    bottomPadding: {
        height: rpx(120),
    },
});

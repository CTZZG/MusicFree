import Checkbox from "@/components/base/checkbox";
import Icon from "@/components/base/icon";
import ListItem, { ListItemHeader } from "@/components/base/listItem";
import ThemeSwitch from "@/components/base/switch";
import ThemeText from "@/components/base/themeText";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import useColors from "@/hooks/useColors";
import type { LyricOrderItem } from "@/types/metadata";
import rpx, { vmax } from "@/utils/rpx";
import Toast from "@/utils/toast";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Pressable, ScrollView } from "react-native-gesture-handler";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { hidePanel } from "../usePanel";

const DEFAULT_LYRIC_ORDER: LyricOrderItem[] = [
    "romanization",
    "original",
    "translation",
];

const LYRIC_ORDER_ITEMS: LyricOrderItem[] = [
    "original",
    "translation",
    "romanization",
];

type MetadataSwitchKey =
    | "writeMetadata"
    | "writeMetadataCover"
    | "writeMetadataLyric"
    | "downloadLyricFile"
    | "enableWordByWord";

export default function MusicMetadataSettings() {
    const colors = useColors();
    const { t } = useI18N();

    const currentWriteMetadata = useAppConfig("basic.writeMetadata");
    const currentWriteMetadataCover = useAppConfig("basic.writeMetadataCover");
    const currentWriteMetadataLyric = useAppConfig("basic.writeMetadataLyric");
    const currentEnableWordByWord = useAppConfig("basic.enableWordByWordLyric");
    const currentDownloadLyricFile = useAppConfig("basic.downloadLyricFile");
    const currentLyricFileFormat = useAppConfig("basic.lyricFileFormat");
    const currentLyricOrder = useAppConfig("basic.lyricOrder");

    const [settings, setSettings] = useState({
        writeMetadata: currentWriteMetadata ?? false,
        writeMetadataCover: currentWriteMetadataCover ?? true,
        writeMetadataLyric: currentWriteMetadataLyric ?? true,
        downloadLyricFile: currentDownloadLyricFile ?? false,
        lyricFileFormat: currentLyricFileFormat ?? "lrc",
        enableWordByWord: currentEnableWordByWord ?? false,
        lyricOrder: currentLyricOrder ?? DEFAULT_LYRIC_ORDER,
    });

    const lyricLabelMap: Record<LyricOrderItem, string> = {
        original: t("panel.musicMetadataSettings.lyric.original"),
        translation: t("panel.musicMetadataSettings.lyric.translation"),
        romanization: t("panel.musicMetadataSettings.lyric.romanization"),
    };

    const handleSave = () => {
        if (
            settings.writeMetadata &&
            settings.writeMetadataLyric &&
            settings.lyricOrder.length === 0
        ) {
            Toast.warn(t("panel.musicMetadataSettings.emptyLyricOrder"));
            return;
        }

        Config.setConfig("basic.writeMetadata", settings.writeMetadata);
        Config.setConfig("basic.writeMetadataCover", settings.writeMetadataCover);
        Config.setConfig("basic.writeMetadataLyric", settings.writeMetadataLyric);
        Config.setConfig("basic.downloadLyricFile", settings.downloadLyricFile);
        Config.setConfig("basic.lyricFileFormat", settings.lyricFileFormat);
        Config.setConfig("basic.enableWordByWordLyric", settings.enableWordByWord);
        Config.setConfig("basic.lyricOrder", settings.lyricOrder);

        Toast.success(t("panel.musicMetadataSettings.saveSuccess"));
        hidePanel();
    };

    const handleReset = () => {
        setSettings({
            writeMetadata: false,
            writeMetadataCover: true,
            writeMetadataLyric: true,
            downloadLyricFile: false,
            lyricFileFormat: "lrc" as "lrc" | "txt",
            enableWordByWord: false,
            lyricOrder: DEFAULT_LYRIC_ORDER,
        });
        Toast.success(t("panel.musicMetadataSettings.resetSuccess"));
    };

    const createSwitchHandler = (key: MetadataSwitchKey) => {
        return (value: boolean) => {
            setSettings(prev => ({
                ...prev,
                [key]: value,
            }));
        };
    };

    const toggleLyricOrderItem = (item: LyricOrderItem) => {
        setSettings(prev => ({
            ...prev,
            lyricOrder: prev.lyricOrder.includes(item)
                ? prev.lyricOrder.filter(current => current !== item)
                : [...prev.lyricOrder, item],
        }));
    };

    const moveLyricOrderItem = (item: LyricOrderItem, delta: -1 | 1) => {
        setSettings(prev => {
            const next = [...prev.lyricOrder];
            const index = next.indexOf(item);
            const nextIndex = index + delta;
            if (index < 0 || nextIndex < 0 || nextIndex >= next.length) {
                return prev;
            }
            [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
            return {
                ...prev,
                lyricOrder: next,
            };
        });
    };

    const renderSwitchItem = (
        title: string,
        value: boolean,
        onValueChange: (value: boolean) => void,
    ) => (
        <ListItem
            withHorizontalPadding
            heightType="small"
            onPress={() => onValueChange(!value)}>
            <ListItem.Content title={title} />
            <ThemeSwitch value={value} onValueChange={onValueChange} />
        </ListItem>
    );

    const renderMoveButton = (
        item: LyricOrderItem,
        delta: -1 | 1,
        disabled: boolean,
    ) => (
        <Pressable
            disabled={disabled}
            style={[
                styles.moveButton,
                disabled && styles.disabledButton,
                { backgroundColor: colors.placeholder },
            ]}
            onPress={() => moveLyricOrderItem(item, delta)}>
            <Icon
                name={delta < 0 ? "arrow-up-tray" : "arrow-down-tray"}
                size={rpx(30)}
                color={colors.text}
            />
        </Pressable>
    );

    const renderLyricOrderItem = (item: LyricOrderItem) => {
        const checked = settings.lyricOrder.includes(item);
        const index = settings.lyricOrder.indexOf(item);
        return (
            <ListItem
                key={item}
                withHorizontalPadding
                heightType="small"
                onPress={() => toggleLyricOrderItem(item)}>
                <View style={styles.checkboxWrapper}>
                    <Checkbox
                        checked={checked}
                        onPress={() => toggleLyricOrderItem(item)}
                    />
                </View>
                <ListItem.Content title={lyricLabelMap[item]} />
                {checked ? (
                    <View style={styles.moveButtonGroup}>
                        {renderMoveButton(item, -1, index === 0)}
                        {renderMoveButton(
                            item,
                            1,
                            index === settings.lyricOrder.length - 1,
                        )}
                    </View>
                ) : null}
            </ListItem>
        );
    };

    const currentOrderText = settings.lyricOrder.length
        ? t("panel.musicMetadataSettings.currentLyricOrder", {
            order: settings.lyricOrder
                .map(item => lyricLabelMap[item])
                .join(" / "),
        })
        : t("panel.musicMetadataSettings.noLyricOrder");

    const lyricFileFormat = {
        title: t("panel.musicMetadataSettings.lyricFileFormat"),
        right: (
            <ThemeText style={styles.formatText}>
                {settings.lyricFileFormat === "lrc"
                    ? t("panel.musicMetadataSettings.lyricFileFormatLrc")
                    : t("panel.musicMetadataSettings.lyricFileFormatTxt")}
            </ThemeText>
        ),
        onPress: () => {
            setSettings(prev => ({
                ...prev,
                lyricFileFormat:
                    prev.lyricFileFormat === "lrc" ? "txt" : "lrc",
            }));
        },
    };

    return (
        <PanelBase
            keyboardAvoidBehavior="height"
            height={vmax(76)}
            renderBody={() => (
                <>
                    <PanelHeader
                        title={t("panel.musicMetadataSettings.title")}
                        onCancel={hidePanel}
                        onOk={handleSave}
                    />
                    <ScrollView style={styles.scrollView}>
                        <ListItemHeader>
                            {t("panel.musicMetadataSettings.section.basic")}
                        </ListItemHeader>
                        {renderSwitchItem(
                            t("panel.musicMetadataSettings.writeMetadata"),
                            settings.writeMetadata,
                            createSwitchHandler("writeMetadata"),
                        )}

                        {settings.writeMetadata ? (
                            <>
                                {renderSwitchItem(
                                    t("panel.musicMetadataSettings.writeCover"),
                                    settings.writeMetadataCover,
                                    createSwitchHandler("writeMetadataCover"),
                                )}
                                {renderSwitchItem(
                                    t("panel.musicMetadataSettings.writeLyric"),
                                    settings.writeMetadataLyric,
                                    createSwitchHandler("writeMetadataLyric"),
                                )}
                            </>
                        ) : null}

                        {renderSwitchItem(
                            t("panel.musicMetadataSettings.downloadLyricFile"),
                            settings.downloadLyricFile,
                            createSwitchHandler("downloadLyricFile"),
                        )}

                        {settings.downloadLyricFile ? (
                            <ListItem
                                withHorizontalPadding
                                heightType="small"
                                onPress={lyricFileFormat.onPress}>
                                <ListItem.Content
                                    title={lyricFileFormat.title}
                                />
                                {lyricFileFormat.right}
                            </ListItem>
                        ) : null}

                        {(settings.writeMetadata &&
                            settings.writeMetadataLyric) ||
                        settings.downloadLyricFile ? (
                            <>
                                <ListItemHeader>
                                    {t(
                                        "panel.musicMetadataSettings.section.lyric",
                                    )}
                                </ListItemHeader>
                                <View style={styles.orderSummary}>
                                    <ThemeText
                                        fontSize="description"
                                        fontColor="textSecondary">
                                        {currentOrderText}
                                    </ThemeText>
                                </View>
                                {LYRIC_ORDER_ITEMS.map(renderLyricOrderItem)}
                                {renderSwitchItem(
                                    t(
                                        "panel.musicMetadataSettings.enableWordByWord",
                                    ),
                                    settings.enableWordByWord,
                                    createSwitchHandler("enableWordByWord"),
                                )}
                            </>
                        ) : null}

                        <ListItemHeader>
                            {t("panel.musicMetadataSettings.section.actions")}
                        </ListItemHeader>
                        <ListItem
                            withHorizontalPadding
                            heightType="small"
                            onPress={handleReset}>
                            <ListItem.Content
                                title={t(
                                    "panel.musicMetadataSettings.resetDefault",
                                )}
                            />
                        </ListItem>
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
    checkboxWrapper: {
        marginRight: rpx(24),
    },
    moveButtonGroup: {
        flexDirection: "row",
        alignItems: "center",
        gap: rpx(12),
    },
    moveButton: {
        width: rpx(56),
        height: rpx(56),
        borderRadius: rpx(8),
        alignItems: "center",
        justifyContent: "center",
    },
    disabledButton: {
        opacity: 0.35,
    },
    orderSummary: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(12),
    },
    formatText: {
        textAlign: "right",
    },
    bottomPadding: {
        height: rpx(72),
    },
});

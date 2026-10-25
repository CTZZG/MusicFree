import React from "react";
import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import ThemeText from "@/components/base/themeText";
import lyricManager, { useLyricState } from "@/core/lyricManager";
import { useI18N } from "@/core/i18n";
import useColors from "@/hooks/useColors";
import PersistStatus from "@/utils/persistStatus";
import { vh } from "@/utils/rpx";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { hidePanel, showPanel } from "../usePanel";

function ToolRow({ title, onPress }: { title: string; onPress: () => void }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={title}
            onPress={onPress}
            style={styles.tool}>
            <ThemeText>{title}</ThemeText>
        </Pressable>
    );
}

interface Props {
    musicItem: IMusic.IMusicItem;
    onDisplayChanged: () => void;
}

/** Less-used controls share existing preferences and panels; the lyric engine is unchanged. */
export default function LyricTools({ musicItem, onDisplayChanged }: Props) {
    const { t } = useI18N();
    const colors = useColors();
    const focused = PersistStatus.useValue("lyric.detailAmlLiteMode", false) ?? false;
    const align = PersistStatus.useValue("lyric.detailAlign", "center");
    const romanization = PersistStatus.useValue("lyric.showRomanization", false) ?? false;
    const { hasRomanization } = useLyricState();
    return (
        <PanelBase
            height={vh(70)}
            renderBody={() => (
                <>
                    <PanelHeader title={t("lyricTools.title")} hideButtons allowTitleWrap />
                    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
                        <View style={styles.row}>
                            <ThemeText style={styles.label}>{t("lyricTools.focus")}</ThemeText>
                            <Switch
                                value={focused}
                                accessibilityLabel={t("lyricTools.focus")}
                                onValueChange={value => {
                                    PersistStatus.set("lyric.detailAmlLiteMode", value);
                                    onDisplayChanged();
                                }}
                            />
                        </View>
                        <View style={styles.row}>
                            <ThemeText style={styles.label}>{t("lyricTools.romanization")}</ThemeText>
                            <Switch
                                value={romanization}
                                disabled={!hasRomanization}
                                accessibilityLabel={t("lyricTools.romanization")}
                                onValueChange={value => {
                                    PersistStatus.set("lyric.showRomanization", value);
                                    onDisplayChanged();
                                }}
                            />
                        </View>
                        {!hasRomanization ? (
                            <ThemeText fontColor="textSecondary">
                                {t("lyric.noRomanization")}
                            </ThemeText>
                        ) : null}
                        <ThemeText>{t("basicSettings.lyric.align")}</ThemeText>
                        <View style={styles.align}>
                            {(["left", "center", "right"] as const).map(value => (
                                <Pressable
                                    key={value}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: align === value }}
                                    accessibilityLabel={t(
                                        `basicSettings.lyric.align.${value}`,
                                    )}
                                    onPress={() => {
                                        PersistStatus.set("lyric.detailAlign", value);
                                        onDisplayChanged();
                                    }}
                                    style={[
                                        styles.alignButton,
                                        align === value
                                            ? { backgroundColor: colors.placeholder }
                                            : null,
                                    ]}>
                                    <ThemeText>
                                        {t(`basicSettings.lyric.align.${value}`)}
                                    </ThemeText>
                                </Pressable>
                            ))}
                        </View>
                        <ToolRow
                            title={t("lyricTools.offset")}
                            onPress={() =>
                                showPanel("SetLyricOffset", {
                                    musicItem,
                                    onPreview(value) {
                                        lyricManager.updateLyricOffset(musicItem, value);
                                        onDisplayChanged();
                                    },
                                    onSubmit(value) {
                                        lyricManager.updateLyricOffset(musicItem, value);
                                        onDisplayChanged();
                                        hidePanel();
                                    },
                                })
                            }
                        />
                        <ToolRow
                            title={t("lyricTools.search")}
                            onPress={() => showPanel("SearchLrc", { musicItem })}
                        />
                        <ToolRow
                            title={t("lyricTools.manage")}
                            onPress={() =>
                                showPanel("MusicItemLyricOptions", { musicItem })
                            }
                        />
                        <ToolRow
                            title={t("shareCard.title")}
                            onPress={() => showPanel("MusicShare", { musicItem })}
                        />
                    </ScrollView>
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    scroll: { flex: 1 },
    label: { flex: 1, marginRight: 12 },
    tool: { minHeight: 52, justifyContent: "center" },
    content: { padding: 20, paddingBottom: 40 },
    row: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 16,
    },
    align: { flexDirection: "row", marginTop: 12, marginBottom: 18, gap: 8 },
    alignButton: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", padding: 12, borderRadius: 10 },
});

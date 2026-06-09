import React, { useMemo, useState } from "react";
import MusicList from "@/components/musicList";
import LocalMusicSheet from "@/core/localMusicSheet";
import { localMusicSheetId, localPluginPlatform, RequestStateCode } from "@/constants/commonConst";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import globalStyle from "@/constants/globalStyle";
import { useI18N } from "@/core/i18n";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import ThemeText from "@/components/base/themeText";
import useColors from "@/hooks/useColors";
import Color from "color";

export default function LocalMusicList() {
    const musicList = LocalMusicSheet.useMusicList();
    const { t } = useI18N();
    const colors = useColors();
    const [sourceFilter, setSourceFilter] = useState<string>("all");

    const sourceFilters = useMemo(
        () => [
            "all",
            ...Array.from(
                new Set(
                    musicList
                        .map(musicItem => musicItem.platform)
                        .filter(Boolean),
                ),
            ).sort((a, b) => a.localeCompare(b)),
        ],
        [musicList],
    );
    const filteredMusicList = useMemo(
        () =>
            sourceFilter === "all"
                ? musicList
                : musicList.filter(
                    musicItem => musicItem.platform === sourceFilter,
                ),
        [musicList, sourceFilter],
    );

    return (
        <HorizontalSafeAreaView style={globalStyle.flex1}>
            <View style={globalStyle.flex1}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={style.filterBar}>
                    {sourceFilters.map(source => {
                        const selected = sourceFilter === source;
                        return (
                            <Pressable
                                key={source}
                                style={[
                                    style.filterChip,
                                    {
                                        backgroundColor: selected
                                            ? Color(colors.primary)
                                                .alpha(0.18)
                                                .toString()
                                            : colors.placeholder,
                                        borderColor: selected
                                            ? colors.primary
                                            : Color(colors.text)
                                                .alpha(0.06)
                                                .toString(),
                                    },
                                ]}
                                onPress={() => setSourceFilter(source)}>
                                <ThemeText
                                    numberOfLines={1}
                                    fontSize="description"
                                    fontWeight="semibold"
                                    color={selected ? colors.primary : colors.text}>
                                    {source === "all"
                                        ? t("localMusic.sourceFilter.all")
                                        : source}
                                </ThemeText>
                            </Pressable>
                        );
                    })}
                </ScrollView>
                <MusicList
                    musicList={filteredMusicList}
                    showIndex
                    state={RequestStateCode.IDLE}
                    musicSheet={{
                        id: localMusicSheetId,
                        title: t("common.local"),
                        platform: localPluginPlatform,
                        musicList: filteredMusicList,
                    }}
                />
            </View>
        </HorizontalSafeAreaView>
    );
}

const style = StyleSheet.create({
    filterBar: {
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(16),
    },
    filterChip: {
        height: rpx(56),
        paddingHorizontal: rpx(18),
        borderRadius: rpx(28),
        borderWidth: StyleSheet.hairlineWidth,
        marginRight: rpx(12),
        alignItems: "center",
        justifyContent: "center",
    },
});

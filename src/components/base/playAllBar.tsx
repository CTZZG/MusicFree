import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import ThemeText from "./themeText";
import useColors from "@/hooks/useColors";
import { showPanel } from "../panels/usePanel";
import TrackPlayer from "@/core/trackPlayer";
import Toast from "@/utils/toast";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import MusicSheet, { useSheetIsStarred } from "@/core/musicSheet";
import { useI18N } from "@/core/i18n";
import { MusicRepeatMode } from "@/constants/trackPlayerConst";
import shuffle from "@/utils/shuffle";

interface IProps {
    musicList: IMusic.IMusicItem[] | null;
    canStar?: boolean;
    musicSheet?: IMusic.IMusicSheetItem | null;
}

/**
 * iOS 歌单页的按钮区：“播放”“随机播放”两个大按钮，下面一排是收藏、
 * 加入歌单、批量编辑。
 */
export default function PlayAllBar(props: IProps) {
    const { musicList, canStar, musicSheet } = props;

    const sheetName = musicSheet?.title;
    const sheetId = musicSheet?.id;
    const hasMusic = !!musicList?.length;

    const navigate = useNavigate();
    const { t } = useI18N();
    const starred = useSheetIsStarred(musicSheet);

    return (
        <View style={style.wrapper}>
            <View style={style.mainRow}>
                <MainButton
                    icon="play"
                    title={t("playAllBar.play")}
                    disabled={!hasMusic}
                    onPress={() => {
                        if (!musicList?.length) {
                            return;
                        }
                        // 随机模式下从随机一首开始，和原来的“播放全部”一致
                        const start =
                            TrackPlayer.repeatMode === MusicRepeatMode.SHUFFLE
                                ? musicList[
                                    Math.floor(Math.random() * musicList.length)
                                ]
                                : musicList[0];
                        TrackPlayer.playWithReplacePlayList(start, musicList);
                    }}
                />
                <MainButton
                    icon="shuffle"
                    title={t("playAllBar.shuffle")}
                    disabled={!hasMusic}
                    onPress={() => {
                        if (!musicList?.length) {
                            return;
                        }
                        // 打乱后的副本作为播放列表，不改全局的播放模式
                        const shuffled = shuffle(musicList);
                        TrackPlayer.playWithReplacePlayList(
                            shuffled[0],
                            shuffled,
                        );
                    }}
                />
            </View>
            <View style={style.secondaryRow}>
                {canStar && musicSheet ? (
                    <SecondaryButton
                        icon={starred ? "heart" : "heart-outline"}
                        title={
                            starred
                                ? t("playAllBar.favorited")
                                : t("playAllBar.favorite")
                        }
                        color={starred ? "#FF375F" : undefined}
                        onPress={async () => {
                            if (!starred) {
                                MusicSheet.starMusicSheet(musicSheet);
                                Toast.success(t("toast.hasStarred"));
                            } else {
                                MusicSheet.unstarMusicSheet(musicSheet);
                                Toast.success(t("toast.hasUnstarred"));
                            }
                        }}
                    />
                ) : null}
                <SecondaryButton
                    icon="folder-plus"
                    title={t("playAllBar.addToSheet")}
                    disabled={!hasMusic}
                    onPress={() => {
                        showPanel("AddToMusicSheet", {
                            musicItem: musicList ?? [],
                            newSheetDefaultName: sheetName,
                        });
                    }}
                />
                <SecondaryButton
                    icon="pencil-square"
                    title={t("playAllBar.batchEdit")}
                    disabled={!hasMusic}
                    onPress={() => {
                        navigate(ROUTE_PATH.MUSIC_LIST_EDITOR, {
                            musicList: musicList,
                            musicSheet: {
                                title: sheetName,
                                id: sheetId,
                            },
                        });
                    }}
                />
            </View>
        </View>
    );
}

function MainButton(props: {
    icon: IIconName;
    title: string;
    disabled?: boolean;
    onPress: () => void;
}) {
    const colors = useColors();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.title}
            accessibilityState={{ disabled: !!props.disabled }}
            disabled={props.disabled}
            onPress={props.onPress}
            style={({ pressed }) => [
                style.mainButton,
                { backgroundColor: colors.placeholder },
                props.disabled ? style.disabled : null,
                pressed ? style.pressed : null,
            ]}>
            <Icon name={props.icon} size={18} color={colors.primary} />
            <ThemeText
                numberOfLines={1}
                fontSize="title"
                fontWeight="semibold"
                fontColor="primary">
                {props.title}
            </ThemeText>
        </Pressable>
    );
}

function SecondaryButton(props: {
    icon: IIconName;
    title: string;
    color?: string;
    disabled?: boolean;
    onPress: () => void;
}) {
    const colors = useColors();
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.title}
            accessibilityState={{ disabled: !!props.disabled }}
            disabled={props.disabled}
            hitSlop={6}
            onPress={props.onPress}
            style={({ pressed }) => [
                style.secondaryButton,
                props.disabled ? style.disabled : null,
                pressed ? style.pressed : null,
            ]}>
            <Icon
                name={props.icon}
                size={18}
                color={props.color ?? colors.primary}
            />
            <ThemeText numberOfLines={1} fontSize="subTitle" fontColor="primary">
                {props.title}
            </ThemeText>
        </Pressable>
    );
}

const style = StyleSheet.create({
    wrapper: {
        alignSelf: "stretch",
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 8,
    },
    mainRow: {
        flexDirection: "row",
        gap: 12,
    },
    mainButton: {
        flex: 1,
        height: 46,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
    },
    secondaryRow: {
        flexDirection: "row",
        justifyContent: "center",
        gap: 24,
        marginTop: 14,
    },
    secondaryButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        minHeight: 32,
    },
    disabled: {
        opacity: 0.4,
    },
    pressed: {
        opacity: 0.6,
    },
});

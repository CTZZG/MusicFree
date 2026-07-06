import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import rpx from "@/utils/rpx";
import { iconSizeConst } from "@/constants/uiConst";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import ThemeText from "./themeText";
import useColors from "@/hooks/useColors";
import { showPanel } from "../panels/usePanel";
import TrackPlayer from "@/core/trackPlayer";
import Toast from "@/utils/toast";
import Icon from "@/components/base/icon.tsx";
import MusicSheet, { useSheetIsStarred } from "@/core/musicSheet";
import { useI18N } from "@/core/i18n";
import { MusicRepeatMode } from "@/constants/trackPlayerConst";

interface IProps {
    musicList: IMusic.IMusicItem[] | null;
    canStar?: boolean;
    musicSheet?: IMusic.IMusicSheetItem | null;
}
export default function (props: IProps) {
    const { musicList, canStar, musicSheet } = props;

    const sheetName = musicSheet?.title;
    const sheetId = musicSheet?.id;
    const hasMusic = !!musicList?.length;

    const colors = useColors();
    const navigate = useNavigate();
    const { t } = useI18N();

    const starred = useSheetIsStarred(musicSheet);

    return (
        <View style={style.topWrapper}>
            <Pressable
                disabled={!hasMusic}
                accessibilityRole="button"
                accessibilityLabel={t("playAllBar.title")}
                style={[style.playAll, !hasMusic ? style.disabledAction : null]}
                onPress={() => {
                    if (musicList?.length) {
                        let defaultPlayMusic = musicList[0];
                        if (
                            TrackPlayer.repeatMode ===
                            MusicRepeatMode.SHUFFLE
                        ) {
                            defaultPlayMusic =
                                musicList[
                                    Math.floor(Math.random() * musicList.length)
                                ];
                        }
                        TrackPlayer.playWithReplacePlayList(
                            defaultPlayMusic,
                            musicList,
                        );
                    }
                }}>
                <View
                    style={[
                        style.playAllIconWrapper,
                        { backgroundColor: colors.placeholder },
                    ]}>
                    <Icon
                        name="play-circle"
                        size={iconSizeConst.normal}
                        color={colors.text}
                    />
                </View>
                <View style={style.playAllTextWrapper}>
                    <ThemeText fontWeight="bold" numberOfLines={1}>
                        {t("playAllBar.title")}
                    </ThemeText>
                    {hasMusic ? (
                        <ThemeText
                            fontSize="tag"
                            fontColor="textSecondary"
                            numberOfLines={1}
                            style={style.playAllCount}>
                            {musicList.length}
                        </ThemeText>
                    ) : null}
                </View>
            </Pressable>
            <View style={style.actions}>
                {canStar && musicSheet ? (
                    <ActionButton
                        icon={starred ? "heart" : "heart-outline"}
                        title={
                            starred
                                ? t("playAllBar.favorited")
                                : t("playAllBar.favorite")
                        }
                        color={starred ? "#e31639" : undefined}
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
                <ActionButton
                    icon="folder-plus"
                    title={t("playAllBar.addToSheet")}
                    disabled={!hasMusic}
                    onPress={async () => {
                        showPanel("AddToMusicSheet", {
                            musicItem: musicList ?? [],
                            newSheetDefaultName: sheetName,
                        });
                    }}
                />
                <ActionButton
                    icon="pencil-square"
                    title={t("playAllBar.batchEdit")}
                    disabled={!hasMusic}
                    onPress={async () => {
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

interface IActionButtonProps {
    icon: "folder-plus" | "heart" | "heart-outline" | "pencil-square";
    title: string;
    color?: string;
    disabled?: boolean;
    onPress: () => void;
}

function ActionButton(props: IActionButtonProps) {
    const { icon, title, color, disabled, onPress } = props;
    const colors = useColors();

    return (
        <Pressable
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={title}
            style={[style.actionButton, disabled ? style.disabledAction : null]}
            onPress={onPress}>
            <View
                style={[
                    style.actionIconWrapper,
                    { backgroundColor: colors.placeholder },
                ]}>
                <Icon
                    name={icon}
                    size={rpx(30)}
                    color={color ?? colors.text}
                />
            </View>
            <ThemeText
                fontSize="tag"
                numberOfLines={1}
                style={style.actionText}>
                {title}
            </ThemeText>
        </Pressable>
    );
}

const style = StyleSheet.create({
    /** playall */
    topWrapper: {
        minHeight: rpx(108),
        paddingHorizontal: rpx(24),
        paddingVertical: rpx(10),
        flexDirection: "row",
        alignItems: "center",
    },
    playAll: {
        flex: 1,
        minWidth: 0,
        height: rpx(72),
        flexDirection: "row",
        alignItems: "center",
    },
    playAllIconWrapper: {
        width: rpx(56),
        height: rpx(56),
        borderRadius: rpx(28),
        marginRight: rpx(14),
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    },
    playAllTextWrapper: {
        minWidth: 0,
        flex: 1,
    },
    playAllCount: {
        marginTop: rpx(4),
    },
    actions: {
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
    },
    actionButton: {
        width: rpx(76),
        minHeight: rpx(84),
        marginLeft: rpx(8),
        alignItems: "center",
        justifyContent: "center",
    },
    actionIconWrapper: {
        width: rpx(48),
        height: rpx(48),
        borderRadius: rpx(24),
        alignItems: "center",
        justifyContent: "center",
    },
    actionText: {
        maxWidth: rpx(74),
        marginTop: rpx(6),
        textAlign: "center",
    },
    disabledAction: {
        opacity: 0.45,
    },
});

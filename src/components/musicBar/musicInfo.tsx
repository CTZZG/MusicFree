import React, { memo, useLayoutEffect } from "react";
import { StyleSheet, View } from "react-native";
import FastImage from "../base/fastImage";
import { ImgAsset } from "@/constants/assetsConst";
import ThemeText from "../base/themeText";
import useColors from "@/hooks/useColors";
import useResolvedMusicArtwork from "@/hooks/useResolvedMusicArtwork";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import TrackPlayer, {
    useCurrentMusic,
    usePlayList,
    useProgress,
} from "@/core/trackPlayer";
import Animated, {
    SharedValue,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { timingConfig } from "@/constants/commonConst";
import { useI18N } from "@/core/i18n";

/** 迷你播放器里的细进度条，只跟着当前歌曲走 */
function MiniProgress() {
    const colors = useColors();
    const progress = useProgress();
    const musicItem = useCurrentMusic();
    const duration =
        progress.duration > 0 ? progress.duration : musicItem?.duration ?? 0;
    const ratio = duration
        ? Math.min(1, Math.max(0, progress.position / duration))
        : 0;

    return (
        <View
            style={[styles.progressTrack, { backgroundColor: colors.placeholder }]}>
            <View
                style={[
                    styles.progressFill,
                    {
                        width: `${ratio * 100}%`,
                        backgroundColor: colors.primary,
                    },
                ]}
            />
        </View>
    );
}

interface IBarMusicItemProps {
    musicItem: IMusic.IMusicItem | null;
    activeIndex: number; // 当前展示的是0/1/2
    transformSharedValue: SharedValue<number>;
}
function BarMusicItemInner(props: IBarMusicItemProps) {
    const { musicItem, activeIndex, transformSharedValue } = props;
    const colors = useColors();
    const resolvedArtwork = useResolvedMusicArtwork(
        activeIndex === 0 ? musicItem : null,
    );

    const animatedStyles = useAnimatedStyle(() => {
        return {
            left: `${(transformSharedValue.value + activeIndex) * 100}%`,
        };
    }, [activeIndex]);

    if (!musicItem) {
        return null;
    }

    return (
        <Animated.View
            accessibilityElementsHidden={activeIndex !== 0}
            importantForAccessibility={
                activeIndex === 0 ? "auto" : "no-hide-descendants"
            }
            style={[styles.container, animatedStyles]}>
            <View style={styles.artworkWrapper}>
                <FastImage
                    style={styles.artworkImg}
                    source={resolvedArtwork ?? musicItem.artwork}
                    placeholderSource={ImgAsset.albumDefault}
                />
            </View>
            <View style={styles.texts} accessible={false}>
                <ThemeText
                    numberOfLines={1}
                    fontSize="subTitle"
                    fontWeight="semibold"
                    color={colors.musicBarText}>
                    {musicItem.title}
                </ThemeText>
                {musicItem.artist ? (
                    <ThemeText
                        numberOfLines={1}
                        fontSize="description"
                        fontColor="textSecondary"
                        style={styles.artist}>
                        {musicItem.artist}
                    </ThemeText>
                ) : null}
                {activeIndex === 0 ? <MiniProgress /> : null}
            </View>
        </Animated.View>
    );
}

const BarMusicItem = memo(
    BarMusicItemInner,
    (prev, curr) =>
        prev.musicItem === curr.musicItem &&
        prev.activeIndex === curr.activeIndex,
);

const styles = StyleSheet.create({
    container: {
        flexDirection: "row",
        width: "100%",
        height: "100%",
        alignItems: "center",
        position: "absolute",
        paddingLeft: 8,
    },
    artworkWrapper: {
        width: 38,
        height: 38,
        borderRadius: 19,
        marginRight: 10,
        overflow: "hidden",
    },
    artworkImg: {
        width: "100%",
        height: "100%",
    },
    texts: {
        flex: 1,
        minWidth: 0,
        justifyContent: "center",
    },
    artist: {
        marginTop: 0,
    },
    progressTrack: {
        marginTop: 3,
        height: 2,
        borderRadius: 2,
        overflow: "hidden",
    },
    progressFill: {
        height: "100%",
    },
});

interface IMusicInfoProps {
    musicItem: IMusic.IMusicItem | null;
    paddingLeft?: number;
}

let skipInFlight = false;

async function skipMusicItem(direction: number) {
    if (skipInFlight) {
        return;
    }
    skipInFlight = true;
    try {
        if (direction === -1) {
            await TrackPlayer.skipToNext();
        } else if (direction === 1) {
            await TrackPlayer.skipToPrevious();
        }
    } catch {
        // Keep gesture callbacks from surfacing an unhandled rejection.
    } finally {
        skipInFlight = false;
    }
}

export default function MusicInfo(props: IMusicInfoProps) {
    const { musicItem } = props;
    const navigate = useNavigate();
    const { t } = useI18N();
    usePlayList();
    const siblingMusicItems = musicItem
        ? {
            prev: TrackPlayer.previousMusic,
            next: TrackPlayer.nextMusic,
        }
        : {
            prev: null,
            next: null,
        };

    // +- 1
    const transformSharedValue = useSharedValue(0);

    const musicItemWidthValue = useSharedValue(0);

    const tapGesture = Gesture.Tap()
        .onEnd((_event, success) => {
            if (success) {
                navigate(ROUTE_PATH.MUSIC_DETAIL);
            }
        })
        .runOnJS(true);

    useLayoutEffect(() => {
        transformSharedValue.value = 0;
    }, [musicItem, transformSharedValue]);

    const panGesture = Gesture.Pan()
        .minPointers(1)
        .maxPointers(1)
        .onUpdate(e => {
            if (musicItemWidthValue.value) {
                transformSharedValue.value =
                    e.translationX / musicItemWidthValue.value;
            }
        })
        .onEnd((e, success) => {
            if (!success) {
                // 还原到原始位置
                transformSharedValue.value = withTiming(
                    0,
                    timingConfig.animationFast,
                );
            } else {
                // fling
                const deltaX = e.translationX;
                const vX = e.velocityX;

                let skip = 0;
                if (musicItemWidthValue.value) {
                    const rate = deltaX / musicItemWidthValue.value;

                    if (Math.abs(rate) > 0.3) {
                        // 先判断距离
                        skip = vX > 0 ? 1 : -1;
                        transformSharedValue.value = withTiming(
                            skip,
                            timingConfig.animationFast,
                            () => {
                                runOnJS(skipMusicItem)(skip);
                            },
                        );
                    } else if (Math.abs(vX) > 1500) {
                        // 再判断速度
                        skip = vX > 0 ? 1 : -1;
                        transformSharedValue.value = skip;
                        runOnJS(skipMusicItem)(skip);
                    } else {
                        transformSharedValue.value = withTiming(
                            0,
                            timingConfig.animationFast,
                        );
                    }
                } else {
                    transformSharedValue.value = 0;
                }
            }
        });

    const gesture = Gesture.Race(panGesture, tapGesture);

    return (
        <GestureDetector gesture={gesture}>
            <View
                style={musicInfoStyles.infoContainer}
                onLayout={e => {
                    musicItemWidthValue.value = e.nativeEvent.layout.width;
                }}
                // 只把歌曲信息合成一个读屏节点，右侧的播放、列表按钮仍可单独聚焦
                accessible
                accessibilityRole="button"
                accessibilityLabel={
                    musicItem
                        ? t("musicBar.nowPlaying.a11y", {
                            title: musicItem.title,
                            artist: musicItem.artist,
                        })
                        : undefined
                }
                accessibilityActions={[{ name: "activate" }]}
                onAccessibilityAction={event => {
                    if (event.nativeEvent.actionName === "activate") {
                        navigate(ROUTE_PATH.MUSIC_DETAIL);
                    }
                }}>
                <BarMusicItem
                    transformSharedValue={transformSharedValue}
                    musicItem={siblingMusicItems.prev}
                    activeIndex={-1}
                />
                <BarMusicItem
                    transformSharedValue={transformSharedValue}
                    musicItem={musicItem}
                    activeIndex={0}
                />
                <BarMusicItem
                    transformSharedValue={transformSharedValue}
                    musicItem={siblingMusicItems.next}
                    activeIndex={1}
                />
            </View>
        </GestureDetector>
    );
}

const musicInfoStyles = StyleSheet.create({
    infoContainer: {
        flex: 1,
        height: "100%",
        alignItems: "center",
        flexDirection: "row",
        overflow: "hidden",
    },
});

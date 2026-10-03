import rpx from "@/utils/rpx";

const HERO_NAV_HEIGHT = 112;
// 下半部分：进度条（带音质、倍速标签）、播放控制、操作栏
const PLAYER_BOTTOM_HEIGHT = 440;
// 封面下方的歌词与歌名；收藏、更多已并进歌名一行
const CONTENT_BELOW_ARTWORK_RESERVE = 350;
const HERO_FOCUS_HEIGHT_RATIO = 0.96;
const HERO_IMAGE_HEIGHT_RATIO = 1.18;
const HERO_MIN_FOCUS_HEIGHT = 300;
// 迷你歌词（大图样式）连同上下边距，与 miniLyric 的 hero 尺寸一致
export const HERO_MINI_LYRIC_BLOCK = 4 + 112 + 52;
// 大图样式内容区的底部留白
export const HERO_CONTENT_BOTTOM_PADDING = 64;
// 量到高度后，焦点区最少留多少（分屏这类极端情况）
const HERO_ABSOLUTE_MIN_FOCUS_HEIGHT = 64;

interface IMusicDetailHeroLayoutOptions {
    windowWidth: number;
    windowHeight: number;
    safeAreaTop: number;
    safeAreaBottom: number;
    /** 实际量到的内容区高度；有了就不再按 PLAYER_BOTTOM_HEIGHT 估算 */
    contentHeight?: number | null;
    /** 实际量到的歌名区域高度；和 contentHeight 一起才生效 */
    songInfoHeight?: number | null;
}

export function getMusicDetailHeroLayout(
    options: IMusicDetailHeroLayoutOptions,
) {
    const {
        windowWidth,
        windowHeight,
        safeAreaTop,
        safeAreaBottom,
        contentHeight,
        songInfoHeight,
    } = options;
    const width = Math.max(1, windowWidth);
    const preferredFocusHeight = width * HERO_FOCUS_HEIGHT_RATIO;
    const measured =
        !!contentHeight &&
        songInfoHeight !== null &&
        songInfoHeight !== undefined;

    let focusHeight: number;
    let showMiniLyric = true;
    if (measured) {
        // 按量到的高度排：焦点区 + 迷你歌词 + 歌名 + 底部留白正好放进内容区，
        // 不会压到进度条。焦点区小于最小值时先去掉迷你歌词，仍放不下再继续缩。
        const spaceForFocus =
            contentHeight -
            rpx(HERO_NAV_HEIGHT + HERO_CONTENT_BOTTOM_PADDING) -
            songInfoHeight;
        const focusWithLyric = spaceForFocus - rpx(HERO_MINI_LYRIC_BLOCK);
        if (focusWithLyric >= rpx(HERO_MIN_FOCUS_HEIGHT)) {
            focusHeight = Math.min(preferredFocusHeight, focusWithLyric);
        } else {
            showMiniLyric = false;
            focusHeight = Math.min(
                preferredFocusHeight,
                Math.max(rpx(HERO_ABSOLUTE_MIN_FOCUS_HEIGHT), spaceForFocus),
            );
        }
    } else {
        const albumContentHeight = Math.max(
            1,
            windowHeight -
                safeAreaTop -
                safeAreaBottom -
                rpx(PLAYER_BOTTOM_HEIGHT),
        );
        const maximumHeight =
            albumContentHeight -
            rpx(HERO_NAV_HEIGHT + CONTENT_BELOW_ARTWORK_RESERVE);
        focusHeight = Math.min(
            preferredFocusHeight,
            Math.max(rpx(HERO_MIN_FOCUS_HEIGHT), maximumHeight),
        );
    }
    const top = safeAreaTop + rpx(HERO_NAV_HEIGHT);
    const availableImageHeight = Math.max(
        focusHeight,
        windowHeight - top - safeAreaBottom,
    );
    const imageHeight = Math.max(
        focusHeight,
        Math.min(width * HERO_IMAGE_HEIGHT_RATIO, availableImageHeight),
    );

    return {
        top,
        bottom: top + imageHeight,
        focusBottom: top + focusHeight,
        width,
        focusHeight,
        imageHeight,
        tapHeight: rpx(HERO_NAV_HEIGHT) + focusHeight,
        showMiniLyric,
    };
}

import rpx from "@/utils/rpx";

const CIRCLE_NAV_HEIGHT = 112;
const CIRCLE_ARTWORK_WIDTH_RATIO = 0.64;
const CIRCLE_ARTWORK_HEIGHT_RATIO = 0.34;
const CIRCLE_ARTWORK_MAX_SIZE = 480;
const CIRCLE_LYRIC_TALL_SCREEN_RATIO = 1.9;

interface IMusicDetailCircleLayoutOptions {
    windowWidth: number;
    windowHeight: number;
    safeAreaTop: number;
    safeAreaBottom: number;
}

// iOS 卡片封面：左右各留 30 左右，比圆形唱片大，但给下面的歌名、进度条和
// 控制按钮留足高度
const SQUARE_ARTWORK_WIDTH_RATIO = 0.84;
const SQUARE_ARTWORK_HEIGHT_RATIO = 0.4;
const SQUARE_ARTWORK_MAX_SIZE = 640;

/**
 * 卡片式封面（方形圆角卡片或圆形唱片）都是普通文档流布局。几何尺寸集中在这里，
 * 封面不会挤到歌名或下面的播放控制里。
 */
export function getMusicDetailCardLayout(
    options: IMusicDetailCircleLayoutOptions,
    shape: "square" | "circle",
) {
    const { windowWidth, windowHeight, safeAreaTop, safeAreaBottom } = options;
    const width = Math.max(1, windowWidth);
    const usableHeight = Math.max(
        1,
        windowHeight - safeAreaTop - safeAreaBottom,
    );
    const isSquare = shape === "square";
    const coverSize = Math.max(
        rpx(280),
        Math.min(
            width *
                (isSquare
                    ? SQUARE_ARTWORK_WIDTH_RATIO
                    : CIRCLE_ARTWORK_WIDTH_RATIO),
            usableHeight *
                (isSquare
                    ? SQUARE_ARTWORK_HEIGHT_RATIO
                    : CIRCLE_ARTWORK_HEIGHT_RATIO),
            rpx(isSquare ? SQUARE_ARTWORK_MAX_SIZE : CIRCLE_ARTWORK_MAX_SIZE),
        ),
    );

    return {
        navHeight: rpx(CIRCLE_NAV_HEIGHT),
        coverSize,
        topGap: rpx(24),
        /** 封面所在区域比封面本身高出的部分（投影留白） */
        coverAreaExtra: rpx(24),
    };
}

// 封面再小于屏宽的这个比例就不好看了，宁可不放迷你歌词
const CARD_MIN_COVER_WIDTH_RATIO = 0.42;
// 极端情况（分屏）下封面也不缩到看不见
const CARD_ABSOLUTE_MIN_COVER = 64;

interface IMusicDetailCardFitOptions {
    windowWidth: number;
    /** 按屏幕宽高估出来的封面边长（getMusicDetailCardLayout） */
    preferredCoverSize: number;
    /** 封面上方的固定留白：导航栏 + 间距 */
    topSpace: number;
    coverAreaExtra: number;
    /** 迷你歌词连同上边距的高度 */
    miniLyricHeight: number;
    /** 实际量到的内容区高度：导航栏所在的顶部到进度条上沿 */
    contentHeight: number | null;
    /** 实际量到的歌名区域高度（随系统字体大小变化） */
    songInfoHeight: number | null;
}

/**
 * 按实际量到的高度收紧卡片封面，保证封面、歌名、迷你歌词不压到下面的进度条。
 *
 * 只按屏幕比例估算时，歌名随系统字体变大、底部控制区比预想的高，内容就会
 * 溢出到进度条上。量到高度之前沿用估算值；空间够时也不放大，只在放不下时缩小，
 * 缩到最小尺寸仍放不下才去掉迷你歌词（点封面仍可看完整歌词）。
 */
export function fitMusicDetailCardCover(options: IMusicDetailCardFitOptions) {
    const {
        windowWidth,
        preferredCoverSize,
        topSpace,
        coverAreaExtra,
        miniLyricHeight,
        contentHeight,
        songInfoHeight,
    } = options;
    if (!contentHeight || songInfoHeight === null) {
        return { coverSize: preferredCoverSize, showMiniLyric: true };
    }

    const spaceForCover =
        contentHeight - topSpace - coverAreaExtra - songInfoHeight;
    const minCoverSize = Math.min(
        preferredCoverSize,
        windowWidth * CARD_MIN_COVER_WIDTH_RATIO,
    );
    const coverWithLyric = spaceForCover - miniLyricHeight;
    if (coverWithLyric >= minCoverSize) {
        return {
            coverSize: Math.min(preferredCoverSize, coverWithLyric),
            showMiniLyric: true,
        };
    }
    return {
        coverSize: Math.max(
            Math.min(preferredCoverSize, CARD_ABSOLUTE_MIN_COVER),
            Math.min(preferredCoverSize, spaceForCover),
        ),
        showMiniLyric: false,
    };
}

export function getMusicDetailCircleLayout(
    options: IMusicDetailCircleLayoutOptions,
) {
    return getMusicDetailCardLayout(options, "circle");
}

export function getMusicDetailCircleLyricLayout(
    options: Pick<
        IMusicDetailCircleLayoutOptions,
        "windowWidth" | "windowHeight"
    >,
) {
    const { windowWidth, windowHeight } = options;
    const screenRatio = windowHeight / Math.max(1, windowWidth);
    const isTallScreen = screenRatio >= CIRCLE_LYRIC_TALL_SCREEN_RATIO;

    return isTallScreen
        ? {
            containerHeight: rpx(156),
            marginTop: rpx(24),
            groupHeight: rpx(52),
            activeFontSize: rpx(32),
            contextFontSize: rpx(27),
            activeLineHeight: rpx(48),
            contextLineHeight: rpx(40),
            fadeHeight: rpx(36),
        }
        : {
            containerHeight: rpx(112),
            marginTop: rpx(16),
            groupHeight: rpx(44),
            activeFontSize: rpx(28),
            contextFontSize: rpx(24),
            activeLineHeight: rpx(40),
            contextLineHeight: rpx(34),
            fadeHeight: rpx(28),
        };
}

// 横屏：左半边只剩导航栏和控制区之间很矮的一条，封面和歌名改为并排
const LANDSCAPE_GAP = 16;
const LANDSCAPE_VERTICAL_PADDING = 12;
const LANDSCAPE_MIN_INFO_WIDTH = 160;
const LANDSCAPE_MAX_COVER = 320;
const LANDSCAPE_MIN_COVER = 48;

/**
 * 横屏歌名区（SongInfo 的 landscape 样式）的尺寸。样式直接取这里的数字，
 * 下面按高度预算行数时用的也是同一份，两边才不会对不上。行高都是显式的单行，
 * 随系统字体大小等比放大（Android 14 起大字号放大得更少，按等比算只会偏保守）。
 */
export const LANDSCAPE_SONG_INFO_METRICS = {
    paddingVertical: 4,
    titleFontSize: 20,
    titleLineHeight: 25,
    artistFontSize: 15,
    artistLineHeight: 20,
    albumFontSize: 13,
    albumLineHeight: 18,
    buttonSize: 32,
} as const;

export interface ILandscapeSongInfoFit {
    showArtist: boolean;
    showAlbum: boolean;
    /** 字大到标题一行都放不下时，标题的放大倍数上限（Text 的 maxFontSizeMultiplier） */
    titleMaxFontScale?: number;
}

/**
 * 按实际高度和字体缩放决定歌名区放几行：标题一定放，其次歌手，最后专辑，
 * 放不下的那行整行省掉（导航栏上本来就有歌名和歌手）。连标题和按钮都放不下
 * 时返回 null，整块不显示。
 */
export function fitLandscapeSongInfo(
    height: number,
    fontScale: number,
): ILandscapeSongInfoFit | null {
    const metrics = LANDSCAPE_SONG_INFO_METRICS;
    const available = height - metrics.paddingVertical * 2;
    const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
    if (available < Math.max(metrics.buttonSize, metrics.titleLineHeight)) {
        return null;
    }

    // RN 的放大倍数上限不能小于 1；上面已经保证 1 倍的标题放得下
    const titleCap =
        Math.floor((available / metrics.titleLineHeight) * 100) / 100;
    const titleScale = Math.min(scale, titleCap);
    let used = metrics.titleLineHeight * titleScale;
    const showArtist = used + metrics.artistLineHeight * scale <= available;
    if (showArtist) {
        used += metrics.artistLineHeight * scale;
    }
    const showAlbum =
        showArtist && used + metrics.albumLineHeight * scale <= available;

    return {
        showArtist,
        showAlbum,
        titleMaxFontScale: titleScale < scale ? titleScale : undefined,
    };
}

interface IMusicDetailLandscapeLayoutOptions {
    /** 左半边内容区（导航栏和控制区之间）实际的宽高 */
    width: number;
    height: number;
    /** 沉浸模式不显示歌名，封面独占 */
    showSongInfo: boolean;
    /** 系统字体缩放（useWindowDimensions().fontScale） */
    fontScale?: number;
}

/**
 * 横屏封面：边长取决于内容区实际的高和宽，放不下就不放（导航栏已经有小封面
 * 和歌名），绝不超出内容区去盖住导航栏或进度条。歌名在封面右边，宽度是剩下的，
 * 行数由 fitLandscapeSongInfo 按同一个高度决定。
 */
export function getMusicDetailLandscapeLayout(
    options: IMusicDetailLandscapeLayoutOptions,
) {
    const { width, height, showSongInfo, fontScale = 1 } = options;
    const songInfo = showSongInfo
        ? fitLandscapeSongInfo(height, fontScale)
        : null;
    const byHeight = height - LANDSCAPE_VERTICAL_PADDING * 2;
    const byWidth = songInfo
        ? width - LANDSCAPE_GAP * 3 - LANDSCAPE_MIN_INFO_WIDTH
        : width - LANDSCAPE_GAP * 2;
    const fitted = Math.min(LANDSCAPE_MAX_COVER, byHeight, byWidth);
    const coverSize = fitted >= LANDSCAPE_MIN_COVER ? fitted : 0;
    const infoWidth = Math.max(
        0,
        width - LANDSCAPE_GAP * (coverSize > 0 ? 3 : 2) - coverSize,
    );
    return { coverSize, infoWidth, gap: LANDSCAPE_GAP, songInfo };
}

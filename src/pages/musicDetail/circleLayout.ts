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

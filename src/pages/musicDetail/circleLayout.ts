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

/**
 * The circle cover is a normal-flow layout. Keep its geometry in one place so
 * the cover never grows into the song information or the bottom player.
 */
export function getMusicDetailCircleLayout(
    options: IMusicDetailCircleLayoutOptions,
) {
    const { windowWidth, windowHeight, safeAreaTop, safeAreaBottom } = options;
    const width = Math.max(1, windowWidth);
    const usableHeight = Math.max(
        1,
        windowHeight - safeAreaTop - safeAreaBottom,
    );
    const coverSize = Math.max(
        rpx(280),
        Math.min(
            width * CIRCLE_ARTWORK_WIDTH_RATIO,
            usableHeight * CIRCLE_ARTWORK_HEIGHT_RATIO,
            rpx(CIRCLE_ARTWORK_MAX_SIZE),
        ),
    );

    return {
        navHeight: rpx(CIRCLE_NAV_HEIGHT),
        coverSize,
        topGap: rpx(24),
    };
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

import rpx from "@/utils/rpx";

const HERO_NAV_HEIGHT = 112;
const PLAYER_BOTTOM_HEIGHT = 240;
const CONTENT_BELOW_ARTWORK_RESERVE = 454;
const HERO_FOCUS_HEIGHT_RATIO = 0.96;
const HERO_IMAGE_HEIGHT_RATIO = 1.18;

interface IMusicDetailHeroLayoutOptions {
    windowWidth: number;
    windowHeight: number;
    safeAreaTop: number;
    safeAreaBottom: number;
}

export function getMusicDetailHeroLayout(
    options: IMusicDetailHeroLayoutOptions,
) {
    const { windowWidth, windowHeight, safeAreaTop, safeAreaBottom } = options;
    const width = Math.max(1, windowWidth);
    const preferredFocusHeight = width * HERO_FOCUS_HEIGHT_RATIO;
    const albumContentHeight = Math.max(
        1,
        windowHeight - safeAreaTop - safeAreaBottom - rpx(PLAYER_BOTTOM_HEIGHT),
    );
    const maximumHeight =
        albumContentHeight -
        rpx(HERO_NAV_HEIGHT + CONTENT_BELOW_ARTWORK_RESERVE);
    const focusHeight = Math.min(
        preferredFocusHeight,
        Math.max(rpx(300), maximumHeight),
    );
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
    };
}

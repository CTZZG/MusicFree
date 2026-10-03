jest.mock("@/utils/rpx", () => ({
    __esModule: true,
    default: (value: number) => value,
}));

import {
    fitMusicDetailCardCover,
    getMusicDetailCardLayout,
    getMusicDetailCircleLayout,
    getMusicDetailCircleLyricLayout,
    getMusicDetailLandscapeLayout,
} from "../circleLayout";

describe("getMusicDetailCircleLayout", () => {
    it("keeps the circle cover below the compact navigation and below the hero scale cap", () => {
        const layout = getMusicDetailCircleLayout({
            windowWidth: 960,
            windowHeight: 1920,
            safeAreaTop: 48,
            safeAreaBottom: 36,
        });

        expect(layout.navHeight).toBe(112);
        expect(layout.topGap).toBe(24);
        expect(layout.coverSize).toBe(480);
    });

    it("reduces the cover on a short portrait viewport", () => {
        const layout = getMusicDetailCircleLayout({
            windowWidth: 720,
            windowHeight: 1280,
            safeAreaTop: 24,
            safeAreaBottom: 24,
        });

        expect(layout.coverSize).toBeCloseTo(418.88, 5);
    });
});

describe("getMusicDetailCardLayout", () => {
    it("lets the square card fill most of the width on a tall phone", () => {
        const layout = getMusicDetailCardLayout(
            {
                windowWidth: 750,
                windowHeight: 1600,
                safeAreaTop: 48,
                safeAreaBottom: 36,
            },
            "square",
        );

        // 750 × 0.84 = 630，比高度上限 (1600 - 84) × 0.4 = 606.4 大，取高度上限
        expect(layout.coverSize).toBeCloseTo(606.4, 5);
    });

    it("caps the square card on a wide, tall viewport", () => {
        const layout = getMusicDetailCardLayout(
            {
                windowWidth: 960,
                windowHeight: 2400,
                safeAreaTop: 0,
                safeAreaBottom: 0,
            },
            "square",
        );

        expect(layout.coverSize).toBe(640);
    });

    it("keeps the circle cover at its existing size", () => {
        const options = {
            windowWidth: 720,
            windowHeight: 1280,
            safeAreaTop: 24,
            safeAreaBottom: 24,
        };

        expect(getMusicDetailCardLayout(options, "circle")).toEqual(
            getMusicDetailCircleLayout(options),
        );
    });
});

describe("getMusicDetailCircleLyricLayout", () => {
    it("uses a larger, lower lyric viewport on tall portrait screens", () => {
        const layout = getMusicDetailCircleLyricLayout({
            windowWidth: 960,
            windowHeight: 1920,
        });

        expect(layout).toEqual({
            containerHeight: 156,
            marginTop: 24,
            groupHeight: 52,
            activeFontSize: 32,
            contextFontSize: 27,
            activeLineHeight: 48,
            contextLineHeight: 40,
            fadeHeight: 36,
        });
    });

    it("keeps the lyric viewport compact on short portrait screens", () => {
        const layout = getMusicDetailCircleLyricLayout({
            windowWidth: 720,
            windowHeight: 1280,
        });

        expect(layout).toEqual({
            containerHeight: 112,
            marginTop: 16,
            groupHeight: 44,
            activeFontSize: 28,
            contextFontSize: 24,
            activeLineHeight: 40,
            contextLineHeight: 34,
            fadeHeight: 28,
        });
    });
});

/**
 * 回归背景：0.9.0 方形封面在一台 2.2:1 的手机上，三行迷你歌词压到了进度条上。
 * 封面只按屏幕比例估算，没算歌名随系统字体变高、底部控制区比预想的高。
 * 下面的数字按那台手机（约 400dp 宽、内容区约 588dp）换算。
 */
describe("fitMusicDetailCardCover", () => {
    const base = {
        windowWidth: 400,
        preferredCoverSize: 328,
        topSpace: 72.5,
        coverAreaExtra: 12.8,
        miniLyricHeight: 96,
    };

    function stackHeight(
        fit: { coverSize: number; showMiniLyric: boolean },
        songInfoHeight: number,
    ) {
        return (
            base.topSpace +
            fit.coverSize +
            base.coverAreaExtra +
            songInfoHeight +
            (fit.showMiniLyric ? base.miniLyricHeight : 0)
        );
    }

    it("keeps the estimate until the heights are measured", () => {
        expect(
            fitMusicDetailCardCover({
                ...base,
                contentHeight: null,
                songInfoHeight: null,
            }),
        ).toEqual({ coverSize: 328, showMiniLyric: true });
    });

    it("never grows the cover when there is spare room", () => {
        expect(
            fitMusicDetailCardCover({
                ...base,
                contentHeight: 900,
                songInfoHeight: 84,
            }),
        ).toEqual({ coverSize: 328, showMiniLyric: true });
    });

    it("shrinks the cover so the mini lyric stays above the seek bar", () => {
        for (const songInfoHeight of [84, 110]) {
            const fit = fitMusicDetailCardCover({
                ...base,
                contentHeight: 588,
                songInfoHeight,
            });
            expect(fit.showMiniLyric).toBe(true);
            expect(fit.coverSize).toBeLessThan(328);
            expect(stackHeight(fit, songInfoHeight)).toBeLessThanOrEqual(588);
        }
    });

    it("drops the mini lyric before the cover gets too small", () => {
        const fit = fitMusicDetailCardCover({
            ...base,
            contentHeight: 360,
            songInfoHeight: 110,
        });

        expect(fit.showMiniLyric).toBe(false);
        expect(fit.coverSize).toBeCloseTo(360 - 72.5 - 12.8 - 110, 5);
        expect(stackHeight(fit, 110)).toBeLessThanOrEqual(360);
    });

    it("keeps a visible cover even when nothing fits", () => {
        const fit = fitMusicDetailCardCover({
            ...base,
            contentHeight: 120,
            songInfoHeight: 110,
        });

        expect(fit).toEqual({ coverSize: 64, showMiniLyric: false });
    });
});

/**
 * 外部复审：横屏播放页封面盖住导航栏和歌名。横屏左半边只剩导航栏（64）和
 * 控制区（约 170）之间很矮的一条，原来封面固定为可用高度的 40% 再叠上歌名，
 * 放不下就上下溢出。
 */
describe("getMusicDetailLandscapeLayout", () => {
    it("fits the cover into the short strip of a phone in landscape", () => {
        const layout = getMusicDetailLandscapeLayout({
            width: 440,
            height: 124,
            showSongInfo: true,
        });

        expect(layout.coverSize).toBe(100);
        expect(layout.coverSize).toBeLessThanOrEqual(124);
        expect(layout.infoWidth).toBe(440 - 16 * 3 - 100);
    });

    it("caps the cover and keeps room for the song info on a tablet", () => {
        const layout = getMusicDetailLandscapeLayout({
            width: 640,
            height: 540,
            showSongInfo: true,
        });

        expect(layout.coverSize).toBe(320);
        expect(layout.infoWidth).toBeGreaterThanOrEqual(160);
    });

    it("lets the cover use the width in immersive mode", () => {
        const layout = getMusicDetailLandscapeLayout({
            width: 440,
            height: 300,
            showSongInfo: false,
        });

        expect(layout.coverSize).toBe(300 - 24);
    });

    it("drops the cover rather than overflowing a very short strip", () => {
        const layout = getMusicDetailLandscapeLayout({
            width: 440,
            height: 60,
            showSongInfo: true,
        });

        expect(layout.coverSize).toBe(0);
        expect(layout.infoWidth).toBe(440 - 16 * 2);
    });
});

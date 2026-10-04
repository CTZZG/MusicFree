import rpx from "./rpx";

export const DEFAULT_DETAIL_LYRIC_FONT_SIZE_INDEX = 1;

export const DETAIL_LYRIC_FONT_SIZES = [24, 30, 36, 42, 54, 66, 84] as const;

/** 保留原有 0–3 档；新增大字号覆盖过去叠加 2× 系统缩放时的范围。 */
export function normalizeDetailLyricFontSizeIndex(value?: number | null) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < DETAIL_LYRIC_FONT_SIZES.length
        ? value
        : DEFAULT_DETAIL_LYRIC_FONT_SIZE_INDEX;
}

export function getDetailLyricFontSize(value?: number | null) {
    return rpx(DETAIL_LYRIC_FONT_SIZES[normalizeDetailLyricFontSizeIndex(value)]);
}

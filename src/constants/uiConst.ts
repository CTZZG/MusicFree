import { CustomizedColors } from "@/hooks/useColors";

/**
 * iOS 字号层级（固定 dp，不随屏宽缩放）。正文比 iOS 的 17 小一号，
 * 兼顾歌曲列表的信息密度。
 */
const fontSizeConst = {
    /** 标签（iOS caption 2） */
    tag: 11,
    /** 描述文本（iOS footnote） */
    description: 13,
    /** 副标题（iOS subheadline） */
    subTitle: 15,
    /** 正文（iOS callout） */
    content: 16,
    /** 标题（iOS headline） */
    title: 17,
    /** 导航栏标题（iOS 标准导航栏） */
    appbar: 17,
};

const fontWeightConst = {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
    bolder: "800",
} as const;

const iconSizeConst = {
    small: 16,
    light: 19,
    normal: 22,
    big: 31,
    large: 37,
};

type ColorKey = "normal" | "secondary" | "highlight" | "primary";
const colorMap: Record<ColorKey, keyof CustomizedColors> = {
    normal: "text",
    secondary: "textSecondary",
    highlight: "textHighlight",
    primary: "primary",
} as const;

/**
 * 系统字体放大倍数的上限（Text 的 maxFontSizeMultiplier）。文字默认跟随系统
 * 放大，只有放在固定尺寸里的文字才设上限：再大就会撑破控件，或把同一屏的
 * 其他内容挤出去。设了上限的文字在上限以内照样跟着放大。
 */
const maxFontScaleConst = {
    /** 高度固定的控件：导航栏、进度时间、角标、提示文字 */
    compact: 1.5,
    /** 本身就很大的标题，比如播放页的歌名区 */
    display: 1.5,
} as const;

export {
    fontSizeConst,
    fontWeightConst,
    iconSizeConst,
    colorMap,
    maxFontScaleConst,
};
export type { ColorKey };

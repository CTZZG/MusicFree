import Config from "@/core/appConfig";

import { DarkTheme as _DarkTheme, DefaultTheme as _DefaultTheme } from "@react-navigation/native";
import { Appearance } from "react-native";
import { GlobalState } from "@/utils/stateMapper";
import {
    AppearanceThemeId,
    resolveStoredAppearance,
    themeIdForColorScheme,
} from "./themeAppearance";

/**
 * iOS 系统配色（浅色）。页面用分组灰底，卡片与弹层用白色。
 * 辅助文字和强调色比 iOS 默认值略深，保证小字号在白底和灰底上
 * 都有 4.5:1 的对比度。
 */
export const lightTheme = {
    ..._DefaultTheme,
    id: "p-light",
    dark: false,
    colors: {
        ..._DefaultTheme.colors,
        background: "transparent",
        text: "#000000",
        textSecondary: "rgba(60, 60, 67, 0.78)",
        textHighlight: "#0066D6",
        primary: "#0066D6",
        pageBackground: "#F2F2F7",
        shadow: "#000000",
        appBar: "#F2F2F7",
        appBarText: "#000000",
        musicBar: "rgba(249, 249, 251, 0.78)",
        musicBarText: "#000000",
        divider: "rgba(60, 60, 67, 0.2)",
        border: "rgba(60, 60, 67, 0.2)",
        listActive: "rgba(0, 0, 0, 0.06)",
        mask: "rgba(0, 0, 0, 0.3)",
        backdrop: "#FFFFFF",
        tabBar: "rgba(249, 249, 251, 0.78)",
        placeholder: "rgba(118, 118, 128, 0.12)",
        artworkPlaceholder: "#E5E5EA",
        success: "#248A3D",
        danger: "#D70015",
        info: "#0066D6",
        card: "#FFFFFF",
        notification: "#FFFFFF",
    },
};

/** iOS 系统配色（深色）：纯黑页面，抬高一级的表面用 #1C1C1E */
export const darkTheme = {
    ..._DarkTheme,
    id: "p-dark",
    dark: true,
    colors: {
        ..._DarkTheme.colors,
        background: "transparent",
        text: "#FFFFFF",
        textSecondary: "rgba(235, 235, 245, 0.72)",
        textHighlight: "#0A84FF",
        primary: "#0A84FF",
        pageBackground: "#000000",
        shadow: "#000000",
        appBar: "#000000",
        appBarText: "#FFFFFF",
        musicBar: "rgba(36, 36, 38, 0.78)",
        musicBarText: "#FFFFFF",
        divider: "rgba(84, 84, 88, 0.65)",
        border: "rgba(84, 84, 88, 0.65)",
        listActive: "rgba(255, 255, 255, 0.08)",
        mask: "rgba(0, 0, 0, 0.5)",
        backdrop: "#1C1C1E",
        tabBar: "rgba(36, 36, 38, 0.78)",
        placeholder: "rgba(118, 118, 128, 0.24)",
        artworkPlaceholder: "#2C2C2E",
        success: "#30D158",
        danger: "#FF453A",
        info: "#0A84FF",
        card: "#1C1C1E",
        notification: "#1C1C1E",
    },
};

type IAppTheme = typeof lightTheme | typeof darkTheme;

interface IBackgroundInfo {
    url?: string;
    blur?: number;
    opacity?: number;
}

const themeStore = new GlobalState<IAppTheme>(lightTheme);
const backgroundStore = new GlobalState<IBackgroundInfo | null>(null);

function themeById(themeId: AppearanceThemeId): IAppTheme {
    return themeId === "p-dark" ? darkTheme : lightTheme;
}

function setup() {
    const resolved = resolveStoredAppearance(
        Config.getConfig("theme.selectedTheme"),
        Config.getConfig("theme.followSystem"),
    );
    if (resolved.needsPersist) {
        Config.setConfig("theme.selectedTheme", resolved.themeId);
        Config.setConfig("theme.followSystem", resolved.followSystem);
    }
    // 跟随系统时首帧就用系统配色，不等 BootstrapComponent 挂载后再切换
    const themeId = resolved.followSystem
        ? themeIdForColorScheme(Appearance.getColorScheme(), resolved.themeId)
        : resolved.themeId;
    themeStore.setValue(themeById(themeId));

    const bgUrl = Config.getConfig("theme.background");
    const bgBlur = Config.getConfig("theme.backgroundBlur");
    const bgOpacity = Config.getConfig("theme.backgroundOpacity");

    backgroundStore.setValue({
        url: bgUrl,
        blur: bgBlur ?? 20,
        opacity: bgOpacity ?? 0.6,
    });
}

function setTheme(themeId: AppearanceThemeId) {
    themeStore.setValue(themeById(themeId));
    Config.setConfig("theme.selectedTheme", themeId);
}

function setBackground(backgroundInfo: Partial<IBackgroundInfo>) {
    const currentBackgroundInfo = backgroundStore.getValue();
    let newBgInfo = {
        ...(currentBackgroundInfo ?? {
            opacity: 0.6,
            blur: 20,
        }),
    };
    if (typeof backgroundInfo.blur === "number") {
        Config.setConfig("theme.backgroundBlur", backgroundInfo.blur);
        newBgInfo.blur = backgroundInfo.blur;
    }
    if (typeof backgroundInfo.opacity === "number") {
        Config.setConfig("theme.backgroundOpacity", backgroundInfo.opacity);
        newBgInfo.opacity = backgroundInfo.opacity;
    }
    if (backgroundInfo.url !== undefined) {
        Config.setConfig("theme.background", backgroundInfo.url);
        newBgInfo.url = backgroundInfo.url;
    }
    backgroundStore.setValue(newBgInfo);
}

function clearBackground() {
    const currentBackgroundInfo = backgroundStore.getValue();
    Config.setConfig("theme.background", undefined);
    backgroundStore.setValue({
        blur: currentBackgroundInfo?.blur ?? 20,
        opacity: currentBackgroundInfo?.opacity ?? 0.6,
    });
}

const Theme = {
    setup,
    setTheme,
    setBackground,
    clearBackground,
    useTheme: themeStore.useValue,
    getTheme: themeStore.getValue,
    useBackground: backgroundStore.useValue,
};

export default Theme;

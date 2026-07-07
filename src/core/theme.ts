import Config from "@/core/appConfig";

import { DarkTheme as _DarkTheme, DefaultTheme as _DefaultTheme } from "@react-navigation/native";
import { GlobalState } from "@/utils/stateMapper";
import { CustomizedColors } from "@/hooks/useColors";
import Color from "color";

export const lightTheme = {
    id: "p-light",
    ..._DefaultTheme,
    colors: {
        ..._DefaultTheme.colors,
        background: "transparent",
        text: "#333333",
        textSecondary: Color("#333333").alpha(0.7).toString(),
        primary: "#f17d34",
        pageBackground: "#fafafa",
        shadow: "#000",
        appBar: "#f17d34",
        appBarText: "#fefefe",
        musicBar: "#f2f2f2",
        musicBarText: "#333333",
        divider: "rgba(0,0,0,0.1)",
        listActive: "rgba(0,0,0,0.1)", // 在手机上表现是ripple
        mask: "rgba(51,51,51,0.2)",
        backdrop: "#f0f0f0",
        tabBar: "#f0f0f0",
        placeholder: "#eaeaea",
        success: "#08A34C",
        danger: "#FC5F5F",
        info: "#0A95C8",
        card: "#e2e2e288",
        notification: "#f0f0f0",
    },
};

export const darkTheme = {
    id: "p-dark",
    ..._DarkTheme,
    colors: {
        ..._DarkTheme.colors,
        background: "transparent",
        text: "#fcfcfc",
        textSecondary: Color("#fcfcfc").alpha(0.7).toString(),
        primary: "#3FA3B5",
        pageBackground: "#202020",
        shadow: "#999",
        appBar: "#262626",
        appBarText: "#fcfcfc",
        musicBar: "#262626",
        musicBarText: "#fcfcfc",
        divider: "rgba(255,255,255,0.1)",
        listActive: "rgba(255,255,255,0.1)", // 在手机上表现是ripple
        mask: "rgba(33,33,33,0.8)",
        backdrop: "#303030",
        tabBar: "#303030",
        placeholder: "#424242",
        success: "#08A34C",
        danger: "#FC5F5F",
        info: "#0A95C8",
        card: "#33333388",
        notification: "#303030",
    },
};

export const frostedGlassTheme = {
    id: "p-frosted-glass",
    ..._DefaultTheme,
    dark: false,
    colors: {
        ..._DefaultTheme.colors,
        background: "transparent",
        text: "#172235",
        textSecondary: Color("#172235").alpha(0.66).toString(),
        primary: "#0A84FF",
        pageBackground: "#eef4fc",
        shadow: "#26405e",
        appBar: "rgba(255, 255, 255, 0.62)",
        appBarText: "#172235",
        musicBar: "rgba(255, 255, 255, 0.4)",
        musicBarText: "#172235",
        divider: "rgba(23, 34, 53, 0.08)",
        listActive: "rgba(10, 132, 255, 0.12)",
        mask: "rgba(20, 34, 48, 0.32)",
        backdrop: "rgba(246, 250, 255, 0.92)",
        tabBar: "rgba(255, 255, 255, 0.52)",
        placeholder: "rgba(255, 255, 255, 0.6)",
        success: "#0A9F58",
        danger: "#E84D5B",
        info: "#0A84FF",
        // 没有模糊底层的普通表面仍用半透明白，玻璃卡片自身背景保持透明
        card: "rgba(255, 255, 255, 0.55)",
        notification: "rgba(255, 255, 255, 0.92)",
    },
};

interface IBackgroundInfo {
    url?: string;
    blur?: number;
    opacity?: number;
}

const themeStore = new GlobalState(darkTheme);
const backgroundStore = new GlobalState<IBackgroundInfo | null>(null);

function setup() {
    let currentTheme = Config.getConfig("theme.selectedTheme") ?? "p-dark";

    // 旧版本的"液体玻璃"主题已改为毛玻璃
    if (currentTheme === "p-liquid-glass") {
        currentTheme = "p-frosted-glass";
        Config.setConfig("theme.selectedTheme", currentTheme);
    }

    if (currentTheme === "p-dark") {
        themeStore.setValue(darkTheme);
    } else if (currentTheme === "p-light") {
        themeStore.setValue(lightTheme);
    } else if (currentTheme === "p-frosted-glass") {
        themeStore.setValue(frostedGlassTheme);
    } else {
        themeStore.setValue({
            ...darkTheme,
            id: currentTheme,
            dark: true,
            colors: {
                ...darkTheme.colors,
                ...((Config.getConfig("theme.colors") as Partial<CustomizedColors>) ?? {}),
            },
        });
    }

    const bgUrl = Config.getConfig("theme.background");
    const bgBlur = Config.getConfig("theme.backgroundBlur");
    const bgOpacity = Config.getConfig("theme.backgroundOpacity");

    backgroundStore.setValue({
        url: bgUrl,
        blur: bgBlur ?? 20,
        opacity: bgOpacity ?? 0.6,
    });
}

function setTheme(
    themeName: string,
    extra?: {
        colors?: Partial<CustomizedColors>;
        background?: IBackgroundInfo;
    },
) {
    if (themeName === "p-liquid-glass") {
        // 旧版本的"液体玻璃"主题已改为毛玻璃
        themeName = "p-frosted-glass";
    }

    if (themeName === "p-light") {
        themeStore.setValue(lightTheme);
    } else if (themeName === "p-dark") {
        themeStore.setValue(darkTheme);
    } else if (themeName === "p-frosted-glass") {
        themeStore.setValue(frostedGlassTheme);
    } else {
        themeStore.setValue({
            ...darkTheme,
            id: themeName,
            dark: true,
            colors: {
                ...darkTheme.colors,
                ...(extra?.colors ?? {}),
            },
        });
    }

    Config.setConfig("theme.selectedTheme", themeName);
    Config.setConfig("theme.colors", themeStore.getValue().colors);

    if (extra?.background) {
        const currentBg = backgroundStore.getValue();
        let newBg: IBackgroundInfo = {
            blur: 20,
            opacity: 0.6,
            ...(currentBg ?? {}),
        };
        if (typeof extra.background.blur === "number") {
            newBg.blur = extra.background.blur;
        }
        if (typeof extra.background.opacity === "number") {
            newBg.opacity = extra.background.opacity;
        }
        if (extra.background.url !== undefined) {
            newBg.url = extra.background.url;
        }

        Config.setConfig("theme.background", newBg.url);
        Config.setConfig("theme.backgroundBlur", newBg.blur);
        Config.setConfig("theme.backgroundOpacity", newBg.opacity);

        backgroundStore.setValue(newBg);
    }
}

function setColors(colors: Partial<CustomizedColors>) {
    const currentTheme = themeStore.getValue();
    if (currentTheme.id !== "p-light" && currentTheme.id !== "p-dark") {
        const newTheme = {
            ...currentTheme,
            colors: {
                ...currentTheme.colors,
                ...colors,
            },
        };
        Config.setConfig("theme.customColors", newTheme.colors);
        Config.setConfig("theme.colors", newTheme.colors);
        themeStore.setValue(newTheme);
    }
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

const configableColorKey: Array<keyof CustomizedColors> = [
    "primary",
    "text",
    "appBar",
    "appBarText",
    "musicBar",
    "musicBarText",
    "pageBackground",
    "backdrop",
    "card",
    "placeholder",
    "tabBar",
    "notification",
];


const Theme = {
    setup,
    setTheme,
    setBackground,
    setColors,
    useTheme: themeStore.useValue,
    getTheme: themeStore.getValue,
    useBackground: backgroundStore.useValue,
    configableColorKey,
};

export default Theme;

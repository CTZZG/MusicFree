/**
 * 毛玻璃材质：决定标签栏、迷你播放器这类悬浮胶囊要不要真模糊，以及上面那层磨砂色有多浓。
 *
 * 有真模糊时，背后的封面和文字已经糊开，磨砂层薄一点文字就清楚；没有模糊时只能靠
 * 磨砂层盖住背后的内容，必须接近不透明，否则封面、标题会从胶囊里透出来。
 */

// Android 12（API 31）起 dimezis 用 RenderNode + RenderEffect 在 GPU 上模糊；
// 更早的版本要逐帧软件截图再模糊，滚动会卡，这些设备不模糊
export const MIN_ANDROID_BLUR_API = 31;

const FROST_RGB = {
    light: "249, 249, 249",
    dark: "30, 30, 32",
};

/**
 * 磨砂层透明度。模糊时 expo-blur 自己还会再叠一层同色调（强度 60 时浅色约 0.47、
 * 深色约 0.41），两层合起来浅色约 0.76、深色约 0.78。
 */
const FROST_OPACITY = {
    blurred: { light: 0.55, dark: 0.62 },
    solid: { light: 0.94, dark: 0.94 },
};

export interface IGlassMaterialOptions {
    dark: boolean;
    /** Platform.OS */
    platform: string;
    /** Platform.Version：Android 上是 API 级别 */
    platformVersion: number | string;
    /** 是否给了要模糊的 BlurTargetView */
    hasBlurTarget: boolean;
}

export interface IGlassMaterial {
    /** 是否渲染真模糊 */
    blur: boolean;
    /** 盖在模糊（或直接盖在背后内容）上面的磨砂色 */
    frostColor: string;
}

export function canBlurBackdrop(
    options: Omit<IGlassMaterialOptions, "dark">,
): boolean {
    if (options.platform === "ios") {
        return true;
    }
    // Android 上 expo-blur 只能模糊 BlurTargetView 里的内容，没有目标就只剩一层半透明色
    return (
        options.platform === "android" &&
        options.hasBlurTarget &&
        Number(options.platformVersion) >= MIN_ANDROID_BLUR_API
    );
}

export function getGlassMaterial(
    options: IGlassMaterialOptions,
): IGlassMaterial {
    const blur = canBlurBackdrop(options);
    const scheme = options.dark ? "dark" : "light";
    const opacity = FROST_OPACITY[blur ? "blurred" : "solid"][scheme];

    return {
        blur,
        frostColor: `rgba(${FROST_RGB[scheme]}, ${opacity})`,
    };
}

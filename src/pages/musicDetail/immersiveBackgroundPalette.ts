import type { ImageColorsResult } from "react-native-image-colors";

export const DEFAULT_IMMERSIVE_AMBIENT_COLOR = "#11151c";

const DARK_NEUTRAL = "#07090d";
const LIFTED_NEUTRAL = "#242a33";

interface IRgbColor {
    red: number;
    green: number;
    blue: number;
}

function parseHexColor(color: string): IRgbColor | undefined {
    const compactColor = color.trim().replace(/^#/, "");
    const expandedColor =
        compactColor.length === 3
            ? compactColor
                .split("")
                .map(channel => channel + channel)
                .join("")
            : compactColor;
    if (!/^[\da-f]{6}$/i.test(expandedColor)) {
        return undefined;
    }
    return {
        red: Number.parseInt(expandedColor.slice(0, 2), 16),
        green: Number.parseInt(expandedColor.slice(2, 4), 16),
        blue: Number.parseInt(expandedColor.slice(4, 6), 16),
    };
}

function mixColor(source: IRgbColor, target: IRgbColor, weight: number) {
    const sourceWeight = 1 - weight;
    return {
        red: Math.round(source.red * sourceWeight + target.red * weight),
        green: Math.round(source.green * sourceWeight + target.green * weight),
        blue: Math.round(source.blue * sourceWeight + target.blue * weight),
    };
}

function desaturateColor(color: IRgbColor, weight: number) {
    const gray =
        color.red * 0.299 + color.green * 0.587 + color.blue * 0.114;
    return mixColor(color, { red: gray, green: gray, blue: gray }, weight);
}

function colorGrayRate(color: IRgbColor) {
    return (
        ((0.299 * color.red + 0.587 * color.green + 0.114 * color.blue) *
            2 -
            255) /
        255
    );
}

function rgbToHex(color: IRgbColor) {
    const toChannel = (channel: number) =>
        Math.max(0, Math.min(255, Math.round(channel)))
            .toString(16)
            .padStart(2, "0");
    return `#${toChannel(color.red)}${toChannel(color.green)}${toChannel(
        color.blue,
    )}`;
}

function firstUsableColor(candidates: Array<string | undefined>) {
    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        if (parseHexColor(candidate)) {
            return candidate;
        }
    }
}

export function normalizeImmersiveAmbientColor(color: string) {
    const parsedColor = parseHexColor(color);
    if (!parsedColor) {
        return DEFAULT_IMMERSIVE_AMBIENT_COLOR;
    }
    const lightness = colorGrayRate(parsedColor);
    let adjustedColor = parsedColor;

    if (lightness > 0.18) {
        const darkenWeight = Math.min(
            0.38,
            0.14 + (lightness - 0.18) * 0.28,
        );
        adjustedColor = mixColor(
            parsedColor,
            parseHexColor(DARK_NEUTRAL)!,
            darkenWeight,
        );
    } else if (lightness < -0.72) {
        adjustedColor = mixColor(
            parsedColor,
            parseHexColor(LIFTED_NEUTRAL)!,
            0.35,
        );
    } else {
        adjustedColor = mixColor(
            parsedColor,
            parseHexColor(DARK_NEUTRAL)!,
            0.06,
        );
    }

    return rgbToHex(desaturateColor(adjustedColor, 0.06));
}

export function resolveImmersiveAmbientColor(result: ImageColorsResult) {
    const candidates =
        result.platform === "android"
            ? [
                result.average,
                result.muted,
                result.dominant,
                result.darkMuted,
                result.vibrant,
            ]
            : result.platform === "ios"
                ? [
                    result.background,
                    result.secondary,
                    result.detail,
                    result.primary,
                ]
                : [
                    result.dominant,
                    result.muted,
                    result.vibrant,
                    result.darkMuted,
                ];

    return normalizeImmersiveAmbientColor(
        firstUsableColor(candidates) ?? DEFAULT_IMMERSIVE_AMBIENT_COLOR,
    );
}

export function createArtworkColorCacheKey(uri: string) {
    let hash = 0;
    for (let index = 0; index < uri.length; index += 1) {
        hash = (hash * 31 + uri.charCodeAt(index)) % 2147483647;
    }
    return `music-detail-${hash.toString(36)}`;
}

export function ambientColorWithAlpha(color: string, alpha: number) {
    const parsedColor =
        parseHexColor(color) ?? parseHexColor(DEFAULT_IMMERSIVE_AMBIENT_COLOR)!;
    const safeAlpha = Math.max(0, Math.min(1, alpha));
    return `rgba(${parsedColor.red}, ${parsedColor.green}, ${
        parsedColor.blue
    }, ${safeAlpha})`;
}

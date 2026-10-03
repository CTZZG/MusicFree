export type AppearanceThemeId = "p-light" | "p-dark";

export interface IResolvedAppearance {
    /** 不跟随系统时使用的配色 */
    themeId: AppearanceThemeId;
    followSystem: boolean;
    /** 存储的值需要改写：旧主题已经移除，或者从未保存过 */
    needsPersist: boolean;
}

/**
 * 外观只剩 iOS 风格的浅色与深色两套配色。毛玻璃（含更早的液体玻璃）与
 * 自定义配色都已移除：用过它们的用户改为跟随系统，从未选过主题的用户也
 * 默认跟随系统；明确选过浅色或深色的用户保持原样。
 */
export function resolveStoredAppearance(
    storedThemeId: string | null | undefined,
    storedFollowSystem: boolean | null | undefined,
): IResolvedAppearance {
    if (storedThemeId === "p-light" || storedThemeId === "p-dark") {
        return {
            themeId: storedThemeId,
            followSystem: storedFollowSystem ?? false,
            needsPersist:
                storedFollowSystem === undefined || storedFollowSystem === null,
        };
    }

    const wasLightGlass =
        storedThemeId === "p-frosted-glass" ||
        storedThemeId === "p-liquid-glass";
    return {
        themeId: wasLightGlass ? "p-light" : "p-dark",
        followSystem: true,
        needsPersist: true,
    };
}

/** 系统配色为空（部分 ROM 不上报）时沿用当前配色，避免启动时闪一下 */
export function themeIdForColorScheme(
    colorScheme: string | null | undefined,
    fallback: AppearanceThemeId,
): AppearanceThemeId {
    if (colorScheme === "dark") {
        return "p-dark";
    }
    if (colorScheme === "light") {
        return "p-light";
    }
    return fallback;
}

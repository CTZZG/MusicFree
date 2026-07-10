export type MusicBarPresentation = "hidden" | "docked" | "floating";

export interface IMusicBarLayoutPolicyInput {
    routeSupportsMusicBar: boolean;
    hasCurrentMusic: boolean;
    keyboardVisible: boolean;
    drawerOpen: boolean;
    floatingTheme: boolean;
    barHeight: number;
    floatingBottom: number;
}

export interface IMusicBarLayoutPolicyResult {
    visible: boolean;
    presentation: MusicBarPresentation;
    reservedBottom: number;
}

export function resolveMusicBarLayout(
    input: IMusicBarLayoutPolicyInput,
): IMusicBarLayoutPolicyResult {
    const visible =
        input.routeSupportsMusicBar &&
        input.hasCurrentMusic &&
        !input.keyboardVisible &&
        !input.drawerOpen;

    if (!visible) {
        return {
            visible: false,
            presentation: "hidden",
            reservedBottom: 0,
        };
    }

    return {
        visible: true,
        presentation: input.floatingTheme ? "floating" : "docked",
        reservedBottom:
            input.barHeight + (input.floatingTheme ? input.floatingBottom : 0),
    };
}

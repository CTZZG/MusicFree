export const LYRIC_TRANSITION_DURATION_MS = 280;

export function getMiniLyricOpacity(distance: number) {
    if (distance <= 0) {
        return 1;
    }
    if (distance === 1) {
        return 0.46;
    }
    if (distance === 2) {
        return 0.2;
    }
    return 0.06;
}

export function getFullLyricOpacity(options: {
    highlight?: boolean;
    light?: boolean;
    amllLiteMode?: boolean;
}) {
    const { highlight = false, light = false, amllLiteMode = false } = options;
    if (light) {
        return 0.9;
    }
    if (highlight) {
        return 1;
    }
    return amllLiteMode ? 0.34 : 0.58;
}

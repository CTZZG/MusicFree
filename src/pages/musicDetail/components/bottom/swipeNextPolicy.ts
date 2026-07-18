export const SWIPE_UP_ACTIVATION_DISTANCE = 12;
export const SWIPE_UP_MAX_HORIZONTAL_DRIFT = 56;
export const SWIPE_UP_DISTANCE_THRESHOLD = 42;
export const SWIPE_UP_VELOCITY_THRESHOLD = 850;
export const SWIPE_UP_MIN_FLING_DISTANCE = 14;

interface ISwipeUpNextGesture {
    translationX: number;
    translationY: number;
    velocityX: number;
    velocityY: number;
}

export function getSwipeUpFeedbackProgress(translationY: number) {
    "worklet";
    if (!Number.isFinite(translationY)) {
        return 0;
    }
    return Math.min(
        1,
        Math.max(0, -translationY / SWIPE_UP_DISTANCE_THRESHOLD),
    );
}

export function shouldTriggerSwipeUpNext(gesture: ISwipeUpNextGesture) {
    "worklet";
    const { translationX, translationY, velocityX, velocityY } = gesture;
    if (
        !Number.isFinite(translationX) ||
        !Number.isFinite(translationY) ||
        !Number.isFinite(velocityX) ||
        !Number.isFinite(velocityY)
    ) {
        return false;
    }

    const upwardDistance = -translationY;
    const upwardVelocity = -velocityY;
    if (upwardDistance <= 0) {
        return false;
    }

    const distanceIsVertical =
        upwardDistance >= Math.abs(translationX) * 1.1;
    const velocityIsVertical =
        upwardVelocity >= Math.abs(velocityX) * 1.1;
    const crossedDistance =
        upwardDistance >= SWIPE_UP_DISTANCE_THRESHOLD && distanceIsVertical;
    const crossedVelocity =
        upwardDistance >= SWIPE_UP_MIN_FLING_DISTANCE &&
        upwardVelocity >= SWIPE_UP_VELOCITY_THRESHOLD &&
        velocityIsVertical;

    return crossedDistance || crossedVelocity;
}

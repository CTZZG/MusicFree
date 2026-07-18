import {
    getSwipeUpFeedbackProgress,
    shouldTriggerSwipeUpNext,
    SWIPE_UP_DISTANCE_THRESHOLD,
    SWIPE_UP_MIN_FLING_DISTANCE,
    SWIPE_UP_VELOCITY_THRESHOLD,
} from "../swipeNextPolicy";

const baseGesture = {
    translationX: 0,
    translationY: 0,
    velocityX: 0,
    velocityY: 0,
};

describe("shouldTriggerSwipeUpNext", () => {
    it("triggers after a deliberate upward drag", () => {
        expect(
            shouldTriggerSwipeUpNext({
                ...baseGesture,
                translationY: -SWIPE_UP_DISTANCE_THRESHOLD,
            }),
        ).toBe(true);
    });

    it("triggers for a short, fast upward fling", () => {
        expect(
            shouldTriggerSwipeUpNext({
                ...baseGesture,
                translationY: -SWIPE_UP_MIN_FLING_DISTANCE,
                velocityY: -SWIPE_UP_VELOCITY_THRESHOLD,
            }),
        ).toBe(true);
    });

    it.each([
        [
            "an upward movement below both thresholds",
            {
                translationY: -(SWIPE_UP_MIN_FLING_DISTANCE - 1),
                velocityY: -(SWIPE_UP_VELOCITY_THRESHOLD - 1),
            },
        ],
        [
            "a downward swipe",
            { translationY: SWIPE_UP_DISTANCE_THRESHOLD + 20 },
        ],
        [
            "a mostly horizontal drag",
            {
                translationX: SWIPE_UP_DISTANCE_THRESHOLD * 2,
                translationY: -SWIPE_UP_DISTANCE_THRESHOLD,
            },
        ],
        [
            "a mostly horizontal fling",
            {
                translationY: -SWIPE_UP_MIN_FLING_DISTANCE,
                velocityX: SWIPE_UP_VELOCITY_THRESHOLD * 2,
                velocityY: -SWIPE_UP_VELOCITY_THRESHOLD,
            },
        ],
    ])("ignores %s", (_label, gesture) => {
        expect(
            shouldTriggerSwipeUpNext({
                ...baseGesture,
                ...gesture,
            }),
        ).toBe(false);
    });

    it("rejects non-finite native gesture values", () => {
        expect(
            shouldTriggerSwipeUpNext({
                ...baseGesture,
                translationY: Number.NaN,
            }),
        ).toBe(false);
    });
});

describe("getSwipeUpFeedbackProgress", () => {
    it.each([
        ["resting", 0, 0],
        ["downward", 20, 0],
        [
            "halfway",
            -SWIPE_UP_DISTANCE_THRESHOLD / 2,
            0.5,
        ],
        ["at threshold", -SWIPE_UP_DISTANCE_THRESHOLD, 1],
        ["past threshold", -SWIPE_UP_DISTANCE_THRESHOLD * 2, 1],
        ["invalid", Number.NaN, 0],
    ])("maps %s movement to feedback progress", (_label, value, expected) => {
        expect(getSwipeUpFeedbackProgress(value)).toBe(expected);
    });
});

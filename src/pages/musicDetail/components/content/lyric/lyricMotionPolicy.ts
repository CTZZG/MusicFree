export interface ILyricMotionPolicyInput {
    reduceMotionEnabled: boolean;
    enableWordByWord: boolean;
    enableWordByWordFloat: boolean;
    enableBreathingDots: boolean;
}

export function getLyricMotionPolicy(input: ILyricMotionPolicyInput) {
    const {
        reduceMotionEnabled,
        enableWordByWord,
        enableWordByWordFloat,
        enableBreathingDots,
    } = input;
    return {
        animateWordByWord: enableWordByWord && !reduceMotionEnabled,
        animateWordFloat:
            enableWordByWord &&
            enableWordByWordFloat &&
            !reduceMotionEnabled,
        animateBreathingDots:
            enableBreathingDots && !reduceMotionEnabled,
        animateLineTransition: !reduceMotionEnabled,
    };
}

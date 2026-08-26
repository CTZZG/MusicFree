import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export interface IAccessibilityPreferences {
    screenReaderEnabled: boolean;
    reduceMotionEnabled: boolean;
}

const initialPreferences: IAccessibilityPreferences = {
    screenReaderEnabled: false,
    reduceMotionEnabled: false,
};

export default function useAccessibilityPreferences() {
    const [preferences, setPreferences] = useState(initialPreferences);

    useEffect(() => {
        let active = true;
        Promise.all([
            AccessibilityInfo.isScreenReaderEnabled(),
            AccessibilityInfo.isReduceMotionEnabled(),
        ]).then(([screenReaderEnabled, reduceMotionEnabled]) => {
            if (active) {
                setPreferences({ screenReaderEnabled, reduceMotionEnabled });
            }
        }).catch(() => {});

        const screenReaderSubscription = AccessibilityInfo.addEventListener(
            "screenReaderChanged",
            screenReaderEnabled => {
                setPreferences(current => ({
                    ...current,
                    screenReaderEnabled,
                }));
            },
        );
        const reduceMotionSubscription = AccessibilityInfo.addEventListener(
            "reduceMotionChanged",
            reduceMotionEnabled => {
                setPreferences(current => ({
                    ...current,
                    reduceMotionEnabled,
                }));
            },
        );

        return () => {
            active = false;
            screenReaderSubscription.remove();
            reduceMotionSubscription.remove();
        };
    }, []);

    return preferences;
}

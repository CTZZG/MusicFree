import { useEffect, useRef } from "react";
import { BackHandler, NativeEventSubscription } from "react-native";

export default function (
    onHardwareBackPress: () => boolean | null | undefined,
    deps: any[] = [],
) {
    const backHandlerRef = useRef<NativeEventSubscription | undefined>(
        undefined,
    );
    useEffect(() => {
        if (backHandlerRef.current) {
            backHandlerRef.current.remove();
            backHandlerRef.current = undefined;
        }

        backHandlerRef.current = BackHandler.addEventListener(
            "hardwareBackPress",
            onHardwareBackPress,
        );

        return () => {
            if (backHandlerRef.current) {
                backHandlerRef.current.remove();
                backHandlerRef.current = undefined;
            }
        };
    }, deps);
}

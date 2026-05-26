import { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import downloadNotificationManager from "@/core/downloadNotificationManager";
import { errorLog } from "@/utils/log";

export function useAppLifecycleNotifications() {
    const appState = useRef(AppState.currentState);

    useEffect(() => {
        const handleAppStateChange = (nextAppState: AppStateStatus) => {
            if (
                appState.current.match(/inactive|background/) &&
                nextAppState === "active"
            ) {
                downloadNotificationManager
                    .refreshNativeNotifications()
                    .catch(error => {
                        errorLog("刷新下载通知状态失败", error);
                    });
            }

            appState.current = nextAppState;
        };

        const subscription = AppState.addEventListener(
            "change",
            handleAppStateChange,
        );

        return () => {
            subscription.remove();
        };
    }, []);
}

export function NotificationLifecycleManager() {
    useAppLifecycleNotifications();
    return null;
}

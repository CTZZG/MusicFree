import i18n from "@/core/i18n";
import Mp3Util from "@/native/mp3Util";
import Toast from "@/utils/toast";
import { errorLog } from "@/utils/log";
import {
    Alert,
    AppState,
    AppStateStatus,
    Linking,
    PermissionsAndroid,
    Platform,
} from "react-native";

interface IPermissionState {
    hasPermission: boolean;
    canRequestPermission: boolean;
    lastRequestTime?: number;
    userDeniedPermanently?: boolean;
}

const REQUEST_COOLDOWN = 5 * 60 * 1000;
const CHECK_INTERVAL = 30 * 1000;
const POST_NOTIFICATIONS =
    (PermissionsAndroid.PERMISSIONS as any).POST_NOTIFICATIONS ??
    "android.permission.POST_NOTIFICATIONS";

class NotificationPermissionManager {
    private permissionState: IPermissionState = {
        hasPermission: false,
        canRequestPermission: true,
    };

    private lastCheckTime = 0;
    private appStateSubscription: { remove: () => void } | null = null;

    setup() {
        if (Platform.OS !== "android" || this.appStateSubscription) {
            return;
        }

        this.appStateSubscription = AppState.addEventListener(
            "change",
            this.handleAppStateChange,
        );
    }

    cleanup() {
        this.appStateSubscription?.remove();
        this.appStateSubscription = null;
    }

    private handleAppStateChange = (nextAppState: AppStateStatus) => {
        if (nextAppState !== "active") {
            return;
        }

        const now = Date.now();
        if (now - this.lastCheckTime > CHECK_INTERVAL) {
            void this.resetPermissionState();
            this.lastCheckTime = now;
        }
    };

    private shouldRequestRuntimePermission() {
        return Platform.OS === "android" && Number(Platform.Version) >= 33;
    }

    async checkPermission(): Promise<boolean> {
        if (Platform.OS !== "android") {
            this.permissionState.hasPermission = true;
            return true;
        }

        try {
            const nativeEnabled =
                await Mp3Util.areDownloadNotificationsEnabled?.().catch(
                    () => false,
                );
            if (!this.shouldRequestRuntimePermission()) {
                this.permissionState.hasPermission = !!nativeEnabled;
                return !!nativeEnabled;
            }

            const runtimeGranted = await PermissionsAndroid.check(
                POST_NOTIFICATIONS,
            );
            const hasPermission = runtimeGranted && !!nativeEnabled;
            this.permissionState.hasPermission = hasPermission;
            if (hasPermission) {
                this.permissionState.userDeniedPermanently = false;
            }
            return hasPermission;
        } catch (error) {
            errorLog("检查通知权限失败", error);
            return false;
        }
    }

    async requestPermission(showRationale = true): Promise<boolean> {
        if (Platform.OS !== "android") {
            return true;
        }

        if (await this.checkPermission()) {
            return true;
        }

        const now = Date.now();
        if (
            this.permissionState.lastRequestTime &&
            now - this.permissionState.lastRequestTime < REQUEST_COOLDOWN
        ) {
            this.showSettingsToast();
            return false;
        }

        if (!this.shouldRequestRuntimePermission()) {
            this.showSettingsToast();
            return false;
        }

        if (showRationale) {
            const shouldRequest = await this.showPermissionRationale();
            if (!shouldRequest) {
                return false;
            }
        }

        try {
            this.permissionState.lastRequestTime = now;
            const result = await PermissionsAndroid.request(POST_NOTIFICATIONS);
            const granted = result === PermissionsAndroid.RESULTS.GRANTED;
            this.permissionState.userDeniedPermanently =
                result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN;

            if (granted) {
                const hasPermission = await this.checkPermission();
                if (hasPermission) {
                    await Mp3Util.refreshDownloadNotifications?.().catch(
                        () => false,
                    );
                    Toast.success(i18n.t("notificationPermission.toast.enabled"));
                    return true;
                }
            }

            this.showSettingsToast();
            return false;
        } catch (error) {
            errorLog("请求通知权限失败", error);
            Toast.warn(i18n.t("notificationPermission.toast.requestFailed"));
            return false;
        }
    }

    async silentRequestPermission(): Promise<boolean> {
        return this.checkPermission();
    }

    async resetPermissionState(): Promise<void> {
        this.permissionState = {
            hasPermission: false,
            canRequestPermission: true,
        };
        await this.checkPermission();
    }

    getPermissionState(): IPermissionState {
        return { ...this.permissionState };
    }

    async getPermissionStatusDescription(): Promise<string> {
        return (await this.checkPermission())
            ? i18n.t("notificationPermission.status.enabled")
            : i18n.t("notificationPermission.status.disabled");
    }

    async openSettings() {
        const openedNative =
            await Mp3Util.openDownloadNotificationSettings?.().catch(
                () => false,
            );
        if (!openedNative) {
            await Linking.openSettings().catch(() => {});
        }
    }

    private showPermissionRationale(): Promise<boolean> {
        return new Promise(resolve => {
            Alert.alert(
                i18n.t("notificationPermission.dialog.title"),
                i18n.t("notificationPermission.dialog.content"),
                [
                    {
                        text: i18n.t("notificationPermission.dialog.cancel"),
                        style: "cancel",
                        onPress: () => resolve(false),
                    },
                    {
                        text: i18n.t("notificationPermission.dialog.ok"),
                        onPress: () => resolve(true),
                    },
                ],
                { cancelable: true, onDismiss: () => resolve(false) },
            );
        });
    }

    private showSettingsToast() {
        Toast.warn(i18n.t("notificationPermission.toast.disabled"), {
            duration: 3000,
            actionText: i18n.t("common.setting"),
            onActionClick: () => {
                void this.openSettings();
            },
        });
    }
}

const notificationPermissionManager = new NotificationPermissionManager();
export default notificationPermissionManager;

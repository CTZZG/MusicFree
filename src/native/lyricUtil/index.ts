import Config from "@/core/appConfig";
import Toast from "@/utils/toast";
import { NativeModule, NativeModules } from "react-native";
import { errorLog } from "@/utils/log.ts";

export enum NativeTextAlignment {
    // 左对齐
    LEFT = 3,
    // 右对齐
    RIGHT = 5,
    // 居中
    CENTER = 17,
}

// 状态栏歌词的工具
interface ILyricUtil extends NativeModule {
    /** 显示状态栏歌词 */
    showStatusBarLyric: (
        initLyric?: string,
        config?: Record<string, any>,
    ) => Promise<void>;
    /** 隐藏状态栏歌词 */
    hideStatusBarLyric: () => Promise<void>;
    /** 设置歌词文本 */
    setStatusBarLyricText: (lyric: string) => Promise<void>;
    /** 设置媒体通知/系统媒体卡片歌词 */
    setMediaNotificationLyricText?: (lyric: string) => Promise<void>;
    /** 清除媒体通知/系统媒体卡片歌词 */
    clearMediaNotificationLyricText?: () => Promise<void>;
    /** 设置 Android 16 Live Update 歌词 */
    setLiveUpdateLyricText?: (lyric: string) => Promise<void>;
    /** 清除 Android 16 Live Update 歌词 */
    clearLiveUpdateLyricText?: () => Promise<void>;
    /** 获取 Android 16 Live Update 歌词状态 */
    getLiveUpdateLyricStatus?: () => Promise<{
        supported: boolean;
        canPostPromotedNotifications: boolean;
        lastPromotable: boolean;
        posted: boolean;
        lastLyric: string;
    }>;
    /** 设置 Live Update 歌词开关，同时调整媒体通知是否参与系统胶囊 */
    setLiveUpdateLyricEnabled?: (enabled: boolean) => Promise<void>;
    /** 设置距离顶部的距离 */
    setStatusBarLyricTop: (percent: number) => Promise<void>;
    /** 设置距离左部的距离 */
    setStatusBarLyricLeft: (percent: number) => Promise<void>;
    /** 设置宽度 */
    setStatusBarLyricWidth: (percent: number) => Promise<void>;
    /** 设置字体 */
    setStatusBarLyricFontSize: (fontSize: number) => Promise<void>;
    /** 设置对齐 */
    setStatusBarLyricAlign: (alignment: NativeTextAlignment) => Promise<void>;
    /** 设置颜色 */
    setStatusBarColors: (
        textColor: string | null,
        backgroundColor: string | null,
    ) => Promise<void>;
    /** 检查权限 */
    checkSystemAlertPermission: () => Promise<boolean>;
    /** 请求悬浮窗 */
    requestSystemAlertPermission: () => Promise<boolean>;
    /** 可选：解密 QQ 音乐 QRC 歌词，native 模块实现后启用 */
    decryptQRCLyric?: (encryptedHex: string) => Promise<string>;
    /** 可选：解密酷我歌词，native 模块实现后启用 */
    decryptKuwoLyric?: (
        lrcBase64: string,
        isGetLyricx?: boolean,
    ) => Promise<string>;
}

const LyricUtil: ILyricUtil = NativeModules.LyricUtil;

const originalShowStatusBarLyric = LyricUtil.showStatusBarLyric;

const showStatusBarLyric: ILyricUtil["showStatusBarLyric"] = async (
    initLyric,
    config,
) => {
    try {
        await originalShowStatusBarLyric(initLyric, config);
    } catch (e) {
        errorLog("状态栏歌词开启失败", e);
        Toast.warn("状态栏歌词开启失败，请到手机系统设置打开悬浮窗权限");
        Config.setConfig("lyric.showStatusBarLyric", false);
    }
};

LyricUtil.showStatusBarLyric = showStatusBarLyric;

export default LyricUtil;

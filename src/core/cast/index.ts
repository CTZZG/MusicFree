import { Cast } from "react-native-nitro-player";
import { devLog, errorLog } from "@/utils/log";

export { isCastSupported } from "./support";

/**
 * Google Cast（投屏）接入。
 *
 * Nitro Player 1.5.0 新增的能力。它把投屏实现为**播放后端热切换**：会话连接后
 * 播放/暂停/跳转/队列等操作由原生侧自动路由到投屏设备并静音本地输出，现有
 * TrackPlayer 调用完全不用改。因此 JS 侧只需要做两件事：
 *   1. 启动时调用一次 configure()，让 Cast 框架完成初始化与设备发现；
 *   2. 提供一个入口让用户选设备（CastButton）。
 *
 * Android 侧依赖（play-services-cast-framework、NitroCastOptionsProvider）由
 * Nitro 的库清单自动合并，应用侧无需额外配置。
 *
 * 仅在 MPV 后端不可用：MPV 有独立播放链路，不经过 Nitro 的播放核心。
 */

let configured = false;

/**
 * 初始化 Cast 框架。可安全重复调用。
 *
 * 不传 receiverApplicationId 时使用平台默认接收器（CC1AD845），它原生支持音频
 * 播放、元数据与队列——对 MusicFree 足够，无需在 Google Cast 控制台注册应用。
 */
export async function setupCast() {
    if (configured) {
        return true;
    }
    try {
        await Cast.configure();
        configured = true;
        devLog("info", "[Cast] 初始化完成");
        return true;
    } catch (error) {
        // 设备无 Google Play 服务、或系统不支持时会失败。这不是致命错误：
        // 投屏按钮会保持隐藏，其余播放功能不受影响。
        errorLog("[Cast] 初始化失败（设备可能无 Google Play 服务）", error);
        return false;
    }
}

export { Cast };

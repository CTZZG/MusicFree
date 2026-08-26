import { devLog, errorLog } from "@/utils/log";

export { isEqualizerSupported } from "./bands";
import { EQUALIZER_BANDS, type IEqualizerController } from "./bands";

/**
 * 真实均衡器实现：接到 Nitro Player 的原生 DSP。
 *
 * Android 走 `DynamicsProcessing`（不可用时回落到 `android.media.audiofx.Equalizer`），
 * iOS 走 `AVAudioUnitEQ`。音频会话由 Nitro 自己在 `TrackPlayerSetup` /
 * `TrackPlayerListener` 里绑定，JS 侧无需关心 sessionId。
 *
 * **只对 Nitro 后端有效**：这些效果器挂在播放器的音频会话上，MPV 有自己的
 * 音频链路，不经过该会话。因此注入这个控制器的地方必须先判断当前后端，
 * 见 `src/entry/bootstrap/bootstrap.ts`。
 */

/**
 * 延迟 require：`react-native-nitro-player` 的入口一被求值就会把 Nitro 的
 * 播放服务（ExoPlayer + Media3 会话）建起来。这个控制器只在 Nitro 后端安装，
 * 因此把 require 推迟到真正使用时，MPV 后端就完全不会碰到 Nitro 那套栈。
 */
function getNitroEqualizer() {
    return (require("react-native-nitro-player") as
        typeof import("react-native-nitro-player")).Equalizer;
}

/** 十段增益必须与 EQUALIZER_BANDS 数量一致，否则原生侧会拒绝。 */
const BAND_COUNT = EQUALIZER_BANDS.length;

function toNativeGains(gains: number[]) {
    const next = new Array<number>(BAND_COUNT).fill(0);
    for (let i = 0; i < BAND_COUNT; i += 1) {
        const value = Number(gains[i]);
        next[i] = Number.isFinite(value) ? value : 0;
    }
    return next;
}

/**
 * 原生调用返回 Promise，但 IEqualizerController 是同步接口（UI 拖动滑杆时
 * 每帧都可能调用）。这里吞掉 rejection 并记录，避免未处理的 Promise：
 * 均衡器失败不应该让播放崩掉。
 */
function fireAndForget(label: string, run: () => Promise<unknown>) {
    try {
        run().catch(error => {
            errorLog(`[Equalizer] ${label} 失败`, error);
        });
    } catch (error) {
        errorLog(`[Equalizer] ${label} 抛出异常`, error);
    }
}

export const nitroEqualizerController: IEqualizerController = {
    setEnabled(enabled) {
        fireAndForget("setEnabled", () => getNitroEqualizer().setEnabled(enabled));
    },
    setGains(gains) {
        fireAndForget(
            "setAllBandGains",
            () => getNitroEqualizer().setAllBandGains(toNativeGains(gains)),
        );
    },
};

export function installNitroEqualizerController(
    setController: (controller: IEqualizerController) => void,
) {
    try {
        setController(nitroEqualizerController);
        devLog("info", "[Equalizer] 已接入 Nitro DSP");
        return true;
    } catch (error) {
        // 拿不到 Nitro 实例时保持原有 no-op controller，UI 仍可用但不影响声音。
        errorLog("[Equalizer] 接入 Nitro DSP 失败", error);
        return false;
    }
}

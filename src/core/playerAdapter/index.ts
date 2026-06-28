import type { PlayerAdapter, PlayerBackendName } from "./types";
import nitroPlayerAdapter from "./nitroPlayerAdapter";

export * from "./types";
export {
    default as nitroPlayerAdapter,
    toNitroTrackItem,
} from "./nitroPlayerAdapter";

let mpvAdapterSingleton: PlayerAdapter<any> | null = null;

/**
 * 按配置解析播放内核适配器。
 * 默认 nitro-player；选中 mpv 时延迟 require，避免在未选用（或 iOS）时初始化原生 mpv 模块。
 */
export function resolvePlayerAdapter(
    backend?: PlayerBackendName | null,
): PlayerAdapter<any> {
    if (backend === "mpv") {
        if (!mpvAdapterSingleton) {
            mpvAdapterSingleton = require("./mpvPlayerAdapter")
                .default as PlayerAdapter<any>;
        }
        return mpvAdapterSingleton;
    }
    return nitroPlayerAdapter;
}

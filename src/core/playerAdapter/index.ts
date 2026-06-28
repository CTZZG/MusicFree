import type { PlayerAdapter, PlayerBackendName } from "./types";

export * from "./types";

let nitroAdapterSingleton: PlayerAdapter<any> | null = null;
let mpvAdapterSingleton: PlayerAdapter<any> | null = null;

function getNitroPlayerAdapter(): PlayerAdapter<any> {
    if (!nitroAdapterSingleton) {
        nitroAdapterSingleton = require("./nitroPlayerAdapter")
            .default as PlayerAdapter<any>;
    }
    return nitroAdapterSingleton;
}

/**
 * 按配置解析播放内核适配器。
 * 默认 nitro-player；两个后端都延迟 require，避免未选用的原生模块抢先创建 MediaSession。
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
    return getNitroPlayerAdapter();
}

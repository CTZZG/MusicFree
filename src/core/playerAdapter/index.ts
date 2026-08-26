import type { PlayerAdapter } from "./types";

export * from "./types";

let mpvAdapterSingleton: PlayerAdapter<any> | null = null;

/**
 * 解析播放内核适配器。
 *
 * 本分支只有 mpv 一个后端。Nitro（ExoPlayer）已整体移除：两套播放栈共存让
 * 每个播放相关改动都要在两条路径上验证，而 Nitro 的入口一被求值就会
 * startService + bind 播放服务，把 ExoPlayer 与 Media3 会话建出来，即便用户
 * 选的是 mpv 也白白常驻一套。
 *
 * 仍然延迟 require：mpv 适配器加载即触碰原生模块，交给调用方决定时机。
 */
export function resolvePlayerAdapter(): PlayerAdapter<any> {
    if (!mpvAdapterSingleton) {
        mpvAdapterSingleton = require("./mpvPlayerAdapter")
            .default as PlayerAdapter<any>;
    }
    return mpvAdapterSingleton;
}

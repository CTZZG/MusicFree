/**
 * 投屏能力判定（纯函数，无依赖）。
 *
 * 与 `./index.ts` 分开的原因和均衡器的 `bands.ts` 一致：这个判定同时被 UI、
 * 启动流程和测试使用，不应该为了读一个布尔值就把日志/原生模块拖进依赖图。
 */

/**
 * 当前播放后端是否支持投屏。
 *
 * 投屏是 Nitro 播放核心内部的后端热切换；MPV 有独立音频链路，不经过该核心，
 * 因此在 MPV 下投屏按钮必须隐藏——否则会重演均衡器那种「点了没反应」的假功能。
 */
export function isCastSupported(playerBackend: unknown) {
    return playerBackend !== "mpv";
}

export function isCastButtonVisible(
    playerBackend: unknown,
    castReady: boolean,
) {
    return castReady && isCastSupported(playerBackend);
}

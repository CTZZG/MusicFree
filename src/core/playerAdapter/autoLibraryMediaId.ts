/**
 * Android Auto 里“我喜欢”“最近播放”的媒体 ID 都以这个前缀开头（见 core/androidAutoLibrary）。
 * 放在播放适配层，适配器据此把点播交给上层，不依赖资料库模块。
 */
export const AUTO_LIBRARY_PREFIX = "library/";

export function isAutoLibraryMediaId(mediaId: string | undefined | null): mediaId is string {
    return typeof mediaId === "string" && mediaId.startsWith(AUTO_LIBRARY_PREFIX);
}

import type { IAppConfig } from "@/types/core/config";
import { Platform } from "react-native";

export function isInsecureMediaPlaybackAllowed(
    config: IAppConfig,
    platform = Platform.OS,
) {
    return platform === "android" &&
        config.getConfig("basic.playerBackend") === "mpv" &&
        config.getConfig("basic.allowInsecureMediaPlayback") === true;
}

/**
 * 插件 API 请求（搜索、榜单、歌单、歌词等）是否允许明文 HTTP。
 *
 * 与 `isInsecureMediaPlaybackAllowed` 是两件事：那个只管 MPV 的媒体流，
 * 这个管插件自己发出的普通请求。默认关闭，由用户显式开启。
 *
 * 这个开关**只放行公网主机的明文**。环回、私网、链路本地、保留地址和
 * URL 内嵌凭据始终拒绝（那才是有真实价值的 SSRF 防护，且在原生传输层
 * 由 PublicHttpsNetworkPolicy 的 Dns 过滤器兜底）；插件安装/更新永远
 * 强制 HTTPS，因为那条链路被劫持等于任意代码执行。
 */
export function isPluginInsecureHttpAllowed(config: IAppConfig) {
    return config.getConfig("basic.allowPluginInsecureHttp") === true;
}

/**
 * 插件/LX 返回的**媒体链接**是否允许明文 HTTP。
 *
 * 两个来源任一成立即可：
 * 1. 用户开启了「允许插件使用 HTTP」。媒体链接是插件的输出，与它的 API 请求属于
 *    同一个信任决定，不应该再额外要求"必须切到 MPV 后端"——那个组合条件导致默认
 *    Nitro 后端下媒体 HTTP 永远被拒，插件只会报「媒体链接仅允许使用 HTTPS」。
 * 2. 旧的 MPV 专用开关仍然生效，保持向后兼容。
 *
 * 与开关无关、始终拒绝的部分：环回、私网、链路本地、保留地址，以及 URL 内嵌凭据。
 * 这些由 `validateRemoteNetworkUrl` 和原生 `PublicHttpsNetworkPolicy` 双重把关。
 */
export function isMediaHttpAllowed(
    config: IAppConfig,
    platform = Platform.OS,
) {
    return isPluginInsecureHttpAllowed(config) ||
        isInsecureMediaPlaybackAllowed(config, platform);
}

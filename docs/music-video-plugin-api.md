# 可选 MV 插件接口

本接口是 MV 接入的分阶段契约；当前 wrapper 已实现，App 播放转换与入口仍在验收中。原有纯音频插件无需修改。

插件可选择提供 `getMusicVideos(song)` 和 `getVideoSource(video, quality?)`，或沿用真实 QQ、Bilibili 插件已有的 `getMvSource(song, quality?)`。两个新方法必须成对存在。宿主仍使用现有插件变量、启用状态及媒体 URL 策略，不另建密钥配置。

```ts
getMusicVideos(song): Promise<Array<{
    id: string;                 // 稳定的视频身份，不能是临时媒体 URL
    title: string;
    artist?: string;
    artwork?: string;
    durationSeconds?: number;   // 秒
    version?: "official" | "live" | "other";
    qualities?: Array<{id: string; label: string; height?: number; bitrate?: number}>;
    timelineId?: string;        // 仅同一剪辑的不同画质可复用
}>>;

getVideoSource(video, quality?): Promise<{
    url?: string;
    headers?: Record<string, string>;
    userAgent?: string;
    quality?: {id: string; label: string; height?: number; bitrate?: number};
    timelineId?: string;
    expiresAt?: number;         // Unix epoch 毫秒，未知则省略
    failure?: IPlugin.IMediaSourceFailure;
} | null>;
```

`getMusicVideos` 返回原歌曲关联的视频版本，不把普通搜索命中当作官方关联。多版本仍需用户选择。画质 id 是插件自己的不透明值，不能把显示标签转换成另一套编号。画质声明不等于实际解码参数或设备输出质量。

兼容旧 `getMvSource` 时保留原歌曲的 `mv`、`vid`、`bvid`、`cid` 等关联字段；显式关联 id 可先形成候选，用户选择之前不解析视频地址。返回的 `videoQuality`、`availableVideoQualities`、`width`、`height`、`duration` 会归一化；未知时间映射、到期时间不补造。没有显式关联字段的旧插件需实际查询确认可用性。

宿主最多处理50个候选、每个30个画质，过滤无效或重复 id。查询与解析各有15秒超时；取消、插件更换、卸载、停用后重启用或修改变量都会使旧请求失效。晚到 Promise 不能接管当前歌曲或触发播放。

元数据缓存最多50首：`cache` 成功5分钟、明确空结果1分钟；`no-cache` 和 `no-store` 每次查询。网络或插件错误不当作空结果缓存。视频 URL 每次实际选择重新解析，既不写歌曲对象，也不进入元数据缓存。

URL 沿用现有媒体准入；headers 和 UA 不允许换行。插件不能授予 `allowInsecureHttpPlayback`、`trustedLocalMediaProxy` 内部权限。首版不接视频解密密钥，已识别的 HLS/DASH 分段流仍拒绝，待有独立验证再开放。音频的既有 CENC 行为保持。

真实订阅兼容验证已记录在 PR64。用户提供的私有 key、临时媒体 URL 不能进入源码、Actions 输入或公开报告。宿主下载解码结果不替代 Android App、实体硬解或物理出声验证。

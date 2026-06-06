# Round 20 Format Sample Matrix

更新时间：2026-06-05

会话入口：`codex://threads/019e57e6-e7c6-7ea0-acc4-8b51258a7196`

本文是 Gate 3 的格式验收矩阵。它用于判断 M4A/ALAC、WMA/ASF、DSF 是否真的达到“支持”，而不是只看 decoder 映射或 extractor 是否编译通过。

当前状态：

- 本轮执行样本搜索，仓库内没有发现 `.m4a`、`.alac`、`.wma`、`.asf`、`.dsf`、`.dff` 样本。
- 用户提供了外部 ASF/WMA 样本：`D:\Downloads\Alice Deejay - Back In My Life.asf`。该样本不在仓库中，`npm run audit:round20-format-samples` 在 `MUSICFREE_FORMAT_SAMPLE_DIRS=D:\Downloads` 下可识别为 WMA v2 / codec id `0x0161`，2ch，44100Hz，WAVEFORMATEX extra data 10 bytes，并默认审计前 512 个 ASF packet。设置 `MUSICFREE_ASF_PACKET_AUDIT_LIMIT=3000` 后已完整扫过该样本的 2081 个 packet，产出 1120 个 WMA sample，pending fragment 为 0。
- 用户又提供了外部 WMA 样本：`D:\Downloads\Bangles 01 - Walk Like An Egyptian.wma`。该样本不在仓库中，同样识别为 WMA v2 / codec id `0x0161`，2ch，44100Hz，WAVEFORMATEX extra data 10 bytes；全量扫过 552 个 packet，产出 552 个 WMA sample，pending fragment 为 0。
- 用户设备上存在 DSF 样本：`/sdcard/music/神様になった日.dsf`。该样本不在仓库中。
- 旧构建对该 DSF 样本表现为 MediaSession duration/position/play/pause 正常，但用户确认实际无声。
- 参考 CTZZG 旧项目后已改为 legacy FFmpeg4 native base + Media3 JNI wrapper；2026-06-04 用户真机确认当前安装包播放 DSF 能听到声音。
- 因此 DSF 本地基础可听播放可以标记为通过；本轮又补了 DSF 专项 fast-forward/seek 类动作、pause/play 和强停重开记录，均为 `error=null`。WMA/ASF 方面，2026-06-05 带 WMA extractor 的真机实验包已让两份 WMA v2 样本进入 `PLAYING`，duration/position、pause/play/fast-forward 和 AudioFlinger output track 均有证据，且无 FFmpeg/direct-buffer 错误；用户已确认实际可听。基于本地和 HTTP Gate 证据，WMA v2/ASF 决策为默认启用，保留 `-PmusicfreeEnableWmaExtractor=false` 作为回滚开关；WMA Pro/Lossless/Voice 仍记录为未覆盖。ALAC 方面，FFmpeg 样本 `D:\Downloads\snoop_try.m4a` 已被审计识别为 `alac`，本地真机播放进入 `PLAYING`，duration/position、pause/play/fast-forward 和 AudioFlinger output track 均有证据；2026-06-05 用户确认实际可听。HTTP Gate 已补三条显式 MainActivity VIEW 入口：WMA、ASF、ALAC 均达到 `PLAYING`，并分别记录 duration/buffered、position 推进和 `error=null`。
- DFF/DSDIFF 不在原始目标内，当前已从本地扫描支持列表移出；保留诊断，不作为 Gate 3 完成前置。
- 样本文件如果有版权风险，不应提交进仓库；可以用本地路径记录验收结果。

## 样本发现命令

```powershell
rg --files -g "*.m4a" -g "*.alac" -g "*.wma" -g "*.asf" -g "*.dsf" -g "*.dff" -g "*.mp3" -g "*.flac" -g "*.ogg" -g "*.opus"
```

## 样本审计命令

```powershell
npm run audit:round20-format-samples
```

默认情况下，该命令只做样本清点、文档口径检查和缺口提示，不会因为仓库内缺样本而失败。这样 `npm run audit:round20-static` 可以持续覆盖 Gate 3 的文档/本地格式口径，同时不把版权样本强行放进仓库。

对 `.m4a` / `.alac`，审计会读取 MP4 `stsd` sample entry，区分 `mp4a` 与 `alac`，避免把普通 M4A/AAC 和 M4A/ALAC 混作同一个证据。对 `.asf` / `.wma`，审计会读取 ASF header 中 audio stream 的 WAVEFORMATEX codec id，并按当前 Kotlin parser/assembler 规则解析 ASF data object、packet、payload 和 sample 重组；`wma-v2-small` 只有识别到 WMA v2 codec id 时才算覆盖，普通 `.asf` 只证明 `asf-audio-only` 样本存在。

如果本机有外部样本目录，可以用 `MUSICFREE_FORMAT_SAMPLE_DIRS` 指向一个或多个目录；多个目录按当前系统的 path delimiter 分隔，Windows 是 `;`，macOS/Linux 是 `:`。

ASF/WMA packet 审计默认最多读取 512 个 packet；需要全量扫样本时可以设置 `MUSICFREE_ASF_PACKET_AUDIT_LIMIT`。例如本轮完整扫描 `D:\Downloads` 下两个 WMA v2 样本使用：

```powershell
$env:MUSICFREE_FORMAT_SAMPLE_DIRS='D:\Downloads'
$env:MUSICFREE_ASF_PACKET_AUDIT_LIMIT='3000'
npm run audit:round20-format-samples
```

当需要把 Gate 3 变成硬门禁时，设置：

```powershell
$env:MUSICFREE_REQUIRE_FORMAT_SAMPLES='1'
npm run audit:round20-format-samples
```

此时缺少 M4A/ALAC、WMA v2/ASF、DSF、MP3/FLAC/OGG 回归样本会让审计失败。M4A/AAC 是普通容器回归 smoke，不是 ALAC 支持的硬门禁；WMA Pro/Lossless 仍是可选覆盖项，但必须在矩阵中记录是否覆盖。

## 样本集要求

| 样本 ID | 格式 | 最低要求 | 当前状态 | 目的 |
| --- | --- | --- | --- | --- |
| `m4a-aac-small` | M4A/AAC | 1 个短音频 | 缺样本；当前 `snoop_try.m4a` 已识别为 `alac`，不会被审计误算成 AAC。该项只作为普通 `.m4a` 回归 smoke，不阻塞 ALAC/WMA/DSF 目标 | 证明普通 `.m4a` 容器不被 ALAC 改动破坏 |
| `m4a-alac-small` | M4A/ALAC | 1 个短音频 | 外部样本存在：`D:\Downloads\snoop_try.m4a`，来源 FFmpeg samples：`https://samples.ffmpeg.org/A-codecs/lossless/ALAC/snoop_try.m4a`；审计识别 `codecs=alac`；真机本地播放 `PLAYING`，duration/buffered 约 `123158ms`，position 推进，pause/play/fast-forward 可用，AudioFlinger output track 已创建；用户确认实际可听；已修复外部打开时 UI 仍显示旧 DSF 的 Nitro 滞后事件污染；HTTP 显式 MainActivity VIEW 入口达到 `PLAYING position=51985 buffered=123158 error=null`，系统 fast-forward 后恢复 `PLAYING` | 证明 `audio/alac -> alac` decoder 路径可用 |
| `m4a-alac-long` | M4A/ALAC | 1 个较长音频 | 同一外部样本 `D:\Downloads\snoop_try.m4a`，大小 `16415231` bytes，duration 约 `123s`，可覆盖较长 ALAC 本地 duration/seek 基线；通用强停重开已通过，仍可补 ALAC 同曲专项恢复记录 | 验证 duration、seek、后台恢复 |
| `wma-v2-small` | WMA v2 / ASF | 1 个短音频 | 外部样本存在：`D:\Downloads\Alice Deejay - Back In My Life.asf` 和 `D:\Downloads\Bangles 01 - Walk Like An Egyptian.wma`；均识别为 `wmav2` / `0x0161`，2ch，44100Hz；全量离线 packet 审计分别为 `2081/2081` 与 `552/552`，sample 分别为 `1120` 与 `552`，pending 均为 `0`；真机实验包 `lastUpdateTime=2026-06-05 16:33:56` 下两者均达到 `PLAYING`、duration/position 和 AudioFlinger output track，Alice 的 pause/play/fast-forward 通过；用户确认实际可听；HTTP WMA 达到 `PLAYING position=33231 buffered=205031 error=null`，系统 pause/play 通过 | 验证 ASF header、packet parser、sample 重组、wmav2 decoder |
| `wma-pro-small` | WMA Pro / ASF | 1 个短音频，如可取得 | 缺样本 | 验证 WMA Pro MIME/codec 映射 |
| `wma-lossless-small` | WMA Lossless / ASF | 1 个短音频，如可取得 | 缺样本 | 验证 lossless codec 映射 |
| `asf-audio-only` | ASF audio-only | 1 个短音频 | 外部样本存在：`D:\Downloads\Alice Deejay - Back In My Life.asf`；header/data object/packet/sample 离线审计已通过；另有 `.wma` 扩展名样本 `D:\Downloads\Bangles 01 - Walk Like An Egyptian.wma` 也通过离线审计；两者均已在真机实验构建上进入 `PLAYING` 并创建 AudioFlinger output track；用户确认实际可听；HTTP ASF 达到 `PLAYING position=43963 buffered=131942 error=null` | 验证 `.asf` / `.wma` 扩展名与 WMA extractor 分支 |
| `dsf-small` | DSF | 1 个短音频 | 缺样本 | 验证 DSF extractor 输出 sample 能被 FFmpeg DSD decoder 接收 |
| `dsf-long` | DSF | 1 个较长音频 | 设备样本存在：`/sdcard/music/神様になった日.dsf`；当前构建用户确认可听；本轮 ADB 专项记录为打开后 `PLAYING position=0 buffered=2925 error=null`，fast-forward 后 `PLAYING position=26573 buffered=47132 error=null`，pause/play 正常，强停重开恢复为同一 DSF 的 `PAUSED position=0 buffered=14952 error=null`，未见 Media3/FFmpeg 崩溃错误 | 验证 duration、seek、大文件内存表现 |
| `dff-small` | DFF/DSDIFF | 仅当未来重新纳入目标时需要 | 目标外；当前不扫描入库 | 当前预期是明确诊断失败；后续若支持需实现 DFF parser |
| `mp3-regression` | MP3 | 1 个普通音频 | 缺样本 | 基础格式回归 |
| `flac-regression` | FLAC | 1 个普通音频 | 缺样本 | 基础格式回归 |
| `ogg-regression` | OGG/Opus | 1 个普通音频 | 缺样本 | 基础格式回归 |

## 每个样本必须记录

- 样本 ID。
- 文件名或本地路径。
- 来源和版权状态。
- codec/container 信息。
- 文件大小。
- duration。
- sample rate。
- channel count。
- bit depth，如可取得。
- 是否本地文件播放。
- 是否 HTTP URL 播放。
- 是否能 seek。
- seek 后音频是否继续。
- 后台播放是否继续。
- 强停恢复后的状态。
- logcat 中的 Nitro/Media3/FFmpeg 错误。

## 验收步骤

### 1. 本地文件播放

目标：证明 MusicFree 的本地文件入口能把样本交给 Nitro。

通过条件：

- 文件能被选择或识别。
- UI 显示标题/文件名。
- 播放进入 `PLAYING`。
- position 推进。
- 没有崩溃。

### 2. HTTP URL 播放

目标：证明插件/网络 URL 路径能播放同类格式。

通过条件：

- Nitro queue 中 track URL 非空。
- 能播放。
- headers/userAgent 不破坏加载。
- 失败时能记录明确错误。

### 3. Duration

目标：证明 extractor 或 container parser 正确报告时长。

通过条件：

- UI duration 与样本真实时长接近。
- `dumpsys media_session` 或 app 状态里的 duration 非 0，且不是明显错误值。

### 4. Seek

目标：证明 seek map 可用或失败语义可接受。

通过条件：

- seek 到 30%、60%、90% 后能继续播放。
- 不出现卡死、崩溃、连续跳曲。
- 如果某格式暂不支持精确 seek，必须有明确策略，不能表现为随机失败。

### 5. 后台和强停恢复

目标：证明格式支持不是只在前台短播有效。

通过条件：

- 后台播放继续。
- 锁屏/通知栏状态合理。
- 强停重开不崩溃。
- 恢复策略与普通格式一致，或明确记录差异。

## 当前格式判定

| 格式 | 当前代码状态 | 当前验收状态 | 是否可宣称支持 |
| --- | --- | --- | --- |
| M4A/AAC | Media3 原生容器/系统路径可用概率高 | 当前缺 AAC `.m4a` 样本；审计已能区分 `mp4a` 与 `alac` | 仅作为普通回归 smoke，不能作为 ALAC 证据，也不阻塞 ALAC 支持判断 |
| M4A/ALAC | FFmpeg `audio/alac -> alac` 映射存在 | FFmpeg ALAC 样本 `snoop_try.m4a` 已识别为 `alac`，本地真机达到 `PLAYING`、duration/position、pause/play/fast-forward 和 AudioFlinger output track，用户确认可听；2026-06-05 HTTP 链接 `https://samples.ffmpeg.org/A-codecs/lossless/ALAC/snoop_try.m4a` 通过显式 MainActivity VIEW 入口测试，MediaSession `PLAYING position=51985 buffered=123158 error=null`，系统 fast-forward 后短暂 `BUFFERING` 并回到 `PLAYING error=null`，未见 decoder/source/direct-buffer 错误 | ALAC 本地与 HTTP 基础链路通过；仍建议补用户听感复核和后台长测记录 |
| WMA/ASF | decoder 映射、完整 WAVEFORMATEX 透传、direct input buffer 和 extractor 第一版存在，默认启用 WMA v1/v2/ASF，保留禁用回滚开关 | 外部 ASF 与 WMA 两个 WMA v2 样本已可被审计识别，全量 ASF packet/sample 离线审计通过；真机实验包达到 `PLAYING`、duration/position、pause/play/fast-forward 和 AudioFlinger output track，无 FFmpeg/direct-buffer 错误；用户确认本地可听；2026-06-05 HTTP WMA 链接达到 `PLAYING position=33231 buffered=205031 error=null`，HTTP ASF 链接达到 `PLAYING position=43963 buffered=131942 error=null`，系统 pause/play 在 WMA 链路上通过 | WMA v2/ASF 本地与 HTTP 基础链路通过；WMA Pro/Lossless/Voice 未覆盖 |
| DSF | DSF extractor 第一版、FFmpeg DSD planar 映射、legacy FFmpeg4 native base 和 Media3 JNI wrapper 存在 | 设备样本当前构建用户确认可听；用户已长时间手测通知栏、蓝牙、详情页、歌词页和长播无问题；本轮 ADB 已补 DSF fast-forward/seek 类动作、pause/play 和强停重开记录，均 `error=null` | DSF 基础矩阵通过；仍建议未来补更多 DSF 样本 |
| DFF/DSDIFF | 不在本地扫描支持列表内；native 只实现 DSF extractor | 保留诊断，缺 parser | 否 |

## 完成条件

Gate 3 只有在以下条件满足后才能标记为完成：

- M4A/AAC 样本通过可证明普通 `.m4a` 未回退；当前仍缺，但它是回归 smoke，不是 ALAC/WMA/DSF 目标硬门禁。
- M4A/ALAC 样本通过，证明 ALAC 不是纸面映射；当前本地基础可听和 HTTP 基础链路均已通过，仍建议补用户听感复核、后台长测记录和强停后的手动恢复记录。
- WMA/ASF 样本至少覆盖 WMA v2；当前两份 WMA v2 样本的本地基础可听已通过，HTTP WMA/ASF 机器链路也已通过；若 WMA Pro/Lossless 无样本，必须记录未覆盖，并决定默认启用范围。
- DSF 已在当前 wrapper 构建上确认真实有声；本轮已补 DSF 专项 seek/fast-forward 和强停恢复证据。
- DFF/DSDIFF 当前已从“支持格式”口径中移出并保留明确诊断；若未来重新纳入，必须实现 DFF parser 并补样本矩阵。
- MP3/FLAC/OGG 基础回归通过。
- 每个失败项都有 logcat 或错误 payload 证据。

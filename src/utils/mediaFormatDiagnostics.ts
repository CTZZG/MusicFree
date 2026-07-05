import { supportLocalMediaType } from "@/constants/commonConst";
import { getMediaExtraProperty } from "@/utils/mediaExtra";
import {
    hasEncryptedMediaSource,
    isCencMediaUrl,
    normalizeCek,
} from "@/utils/mflac";
import { canProxyCencSource } from "@/service/encryptedMediaProxy";
import { getLowerFileExtension } from "@/utils/mediaPath";

export type MediaFormatSupportLevel =
    | "supported"
    | "partial"
    | "blocked"
    | "unknown";

export interface IMediaFormatDiagnostics {
    extension: string;
    level: MediaFormatSupportLevel;
    playable: boolean;
    downloadable: boolean;
    taggable: boolean;
    coverWritable: boolean;
    lyricWritable: boolean;
    reason: string;
}

const taggableFormats = new Set(["mp3", "flac", "ogg", "m4a", "mp4"]);
const coverWritableFormats = new Set(["mp3", "flac", "ogg", "m4a", "mp4"]);
const knownPlayableFormats = new Set(
    supportLocalMediaType.map(item => item.replace(/^\./, "").toLowerCase()),
);
const encryptedFormats = new Set(["mflac", "mgg", "mmp4", "qmc0", "qmc3"]);
const experimentalFormatDiagnostics: Record<
    string,
    Pick<
        IMediaFormatDiagnostics,
        | "level"
        | "playable"
        | "downloadable"
        | "taggable"
        | "coverWritable"
        | "lyricWritable"
        | "reason"
    >
> = {
    m4a: {
        level: "supported",
        playable: true,
        downloadable: true,
        taggable: true,
        coverWritable: true,
        lyricWritable: true,
        reason: "M4A 容器可播放；AAC 走系统/Media3 原生链路，ALAC 已通过 Nitro FFmpeg 样本的本地与 HTTP 基础播放验证。基础标签、封面 covr atom 和歌词写入已接入。",
    },
    wma: {
        level: "partial",
        playable: true,
        downloadable: true,
        taggable: false,
        coverWritable: false,
        lyricWritable: false,
        reason: "WMA v1/v2/ASF 路径已默认启用：Nitro FFmpeg decoder 映射、完整 WAVEFORMATEX 透传和 ASF/WMA extractor 第一版已接入，WMA v2 本地与 HTTP 基础链路通过。WMA Pro/Lossless/Voice 仍未覆盖，可用 -PmusicfreeEnableWmaExtractor=false 回滚。",
    },
    asf: {
        level: "partial",
        playable: true,
        downloadable: true,
        taggable: false,
        coverWritable: false,
        lyricWritable: false,
        reason: "ASF/WMA extractor 第一版已默认注册，WMA v2 ASF 样本的本地与 HTTP 基础播放、duration、seek 类媒体键和 AudioFlinger 输出均有证据。WMA Pro/Lossless/Voice 仍未覆盖，可用 -PmusicfreeEnableWmaExtractor=false 回滚。",
    },
    dsf: {
        level: "partial",
        playable: true,
        downloadable: true,
        taggable: false,
        coverWritable: false,
        lyricWritable: false,
        reason: "DSF 已接入 Nitro DSF extractor、保守 seek map、legacy FFmpeg4 native base 和 Media3 DSD wrapper；设备样本已确认可听，fast-forward/seek 类动作、pause/play 和强停重开记录均为 error=null。仍建议未来补更多 DSF 样本。",
    },
    dff: {
        level: "partial",
        playable: false,
        downloadable: true,
        taggable: false,
        coverWritable: false,
        lyricWritable: false,
        reason: "DFF/DSDIFF 不在当前本地扫描支持列表内；Nitro native 扩展只实现了 DSF extractor，DFF 需要单独 parser 或明确失败提示，暂不能宣称可直接播放。",
    },
};

function normalizeExtension(extension?: string) {
    return (extension ?? "")
        .replace(/^\./, "")
        .trim()
        .toLowerCase();
}

export function inferMediaExtension(
    musicItem: IMusic.IMusicItem,
    sourceUrl?: string,
) {
    const localPath = getMediaExtraProperty(musicItem, "localPath") as
        | string
        | undefined;
    const candidates = [
        localPath,
        sourceUrl,
        musicItem.url,
        typeof musicItem.id === "string" ? musicItem.id : undefined,
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
        const extension = getLowerFileExtension(candidate);
        if (extension) {
            return normalizeExtension(extension);
        }
    }

    return "";
}

export function getMediaFormatDiagnostics(
    musicItem: IMusic.IMusicItem,
    sourceUrl?: string,
): IMediaFormatDiagnostics {
    const extension = inferMediaExtension(musicItem, sourceUrl);
    const url = sourceUrl ?? musicItem.url;
    const cek = normalizeCek((musicItem as any).cek);
    const encrypted =
        encryptedFormats.has(extension) ||
        hasEncryptedMediaSource(url, musicItem.ekey);

    if (encrypted) {
        const cencWithKey = !!cek && isCencMediaUrl(url);
        if (cencWithKey && canProxyCencSource({ url, cek })) {
            return {
                extension: extension || "mmp4",
                level: "partial",
                playable: true,
                downloadable: true,
                taggable: true,
                coverWritable: true,
                lyricWritable: true,
                reason: "CENC MMP4 已接入 Android 原生 AES-CTR 解密：播放走本地 Range 代理，下载会先保存加密缓存再解密为 M4A 后写入标签、封面和歌词。仍建议用更多平台样本继续验证。",
            };
        }
        return {
            extension: extension || "encrypted",
            level: "blocked",
            playable: false,
            downloadable: false,
            taggable: false,
            coverWritable: false,
            lyricWritable: false,
            reason: cencWithKey
                ? "已识别到 CENC 音源和 CEK，但原生解密/本地代理链路尚未接入，当前保持阻止以避免保存不可播放文件。"
                : "加密音源需要原生解密/代理链路，当前保持阻止以避免保存不可播放文件。",
        };
    }

    if (!extension) {
        return {
            extension: "unknown",
            level: "unknown",
            playable: true,
            downloadable: true,
            taggable: false,
            coverWritable: false,
            lyricWritable: false,
            reason: "未能从本地路径或音源链接识别扩展名，将按插件返回和播放器探测结果处理。",
        };
    }

    const experimentalDiagnostics = experimentalFormatDiagnostics[extension];
    if (experimentalDiagnostics) {
        return {
            extension,
            ...experimentalDiagnostics,
        };
    }

    const playable = knownPlayableFormats.has(extension);
    const taggable = taggableFormats.has(extension);
    const coverWritable = coverWritableFormats.has(extension);

    if (!playable) {
        return {
            extension,
            level: "unknown",
            playable: false,
            downloadable: false,
            taggable: false,
            coverWritable: false,
            lyricWritable: false,
            reason: "不在当前本地播放器声明支持的扩展名内，下载时会回退为 mp3 扩展或等待插件提供明确格式。",
        };
    }

    if (!taggable) {
        return {
            extension,
            level: "partial",
            playable: true,
            downloadable: true,
            taggable: false,
            coverWritable: false,
            lyricWritable: false,
            reason: "播放和下载可用，但暂未验证标签、封面或内嵌歌词写入。",
        };
    }

    return {
        extension,
        level: "supported",
        playable: true,
        downloadable: true,
        taggable: true,
        coverWritable,
        lyricWritable: true,
        reason: "播放、下载、基础标签、封面和歌词写入路径已接入。",
    };
}

function boolText(value: boolean) {
    return value ? "支持" : "不支持";
}

export function formatMediaFormatDiagnosticsText(
    diagnostics: IMediaFormatDiagnostics,
) {
    const levelText =
        diagnostics.level === "supported"
            ? "完整支持"
            : diagnostics.level === "partial"
                ? "部分支持"
                : diagnostics.level === "blocked"
                    ? "已阻止"
                    : "需要探测";

    return [
        `格式：${diagnostics.extension}`,
        `状态：${levelText}`,
        `播放：${boolText(diagnostics.playable)}`,
        `下载：${boolText(diagnostics.downloadable)}`,
        `标签写入：${boolText(diagnostics.taggable)}`,
        `封面写入：${boolText(diagnostics.coverWritable)}`,
        `歌词写入：${boolText(diagnostics.lyricWritable)}`,
        "",
        diagnostics.reason,
    ].join("\n");
}

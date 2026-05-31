import { supportLocalMediaType } from "@/constants/commonConst";
import { getMediaExtraProperty } from "@/utils/mediaExtra";
import { hasEncryptedMediaSource } from "@/utils/mflac";

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

const taggableFormats = new Set(["mp3", "flac", "ogg"]);
const coverWritableFormats = new Set(["mp3", "flac", "ogg"]);
const knownPlayableFormats = new Set(
    supportLocalMediaType.map(item => item.replace(/^\./, "").toLowerCase()),
);
const encryptedFormats = new Set(["mflac", "mgg", "mmp4", "qmc0", "qmc3"]);

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
        const clean = candidate.split("?")[0].split("#")[0];
        const match = clean.match(/\.([a-z0-9]+)$/i);
        if (match?.[1]) {
            return normalizeExtension(match[1]);
        }
    }

    return "";
}

export function getMediaFormatDiagnostics(
    musicItem: IMusic.IMusicItem,
    sourceUrl?: string,
): IMediaFormatDiagnostics {
    const extension = inferMediaExtension(musicItem, sourceUrl);
    const encrypted =
        encryptedFormats.has(extension) ||
        hasEncryptedMediaSource(sourceUrl ?? musicItem.url, musicItem.ekey);

    if (encrypted) {
        return {
            extension: extension || "encrypted",
            level: "blocked",
            playable: false,
            downloadable: false,
            taggable: false,
            coverWritable: false,
            lyricWritable: false,
            reason: "加密音源需要原生解密/代理链路，当前保持阻止以避免保存不可播放文件。",
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

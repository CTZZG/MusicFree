import { compare, validate } from "compare-versions";
import DeviceInfo from "react-native-device-info";
import { validateRemoteNetworkUrl } from "./remoteNetworkPolicy";
import { createRestrictedHttpClient } from "./restrictedHttpClient";

// 本分支的版本只发布在这个仓库的 GitHub Releases 上。上游的 version.json
// 不会提示本分支的版本，以前的“检查更新”因此形同虚设。
const RELEASE_REPO = "CTZZG/MusicFree";
const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
// api.github.com 连不上时的后备：jsDelivr 只能告诉我们最新的版本号，
// 下载就指向那个版本的发布页面
const LATEST_TAG_FALLBACK = `https://data.jsdelivr.com/v1/packages/gh/${RELEASE_REPO}/resolved?specifier=latest`;
const MAX_CHANGELOG_LINES = 40;

export interface IUpdateInfo {
    needUpdate: boolean;
    data?: {
        version: string;
        changeLog: string[];
        download: string[];
    };
}

const updateHttpClient = createRestrictedHttpClient({
    maxResponseBytes: 256 * 1024,
    maxTimeoutMs: 8_000,
});

function safeUrl(value: unknown) {
    if (typeof value !== "string") {
        return null;
    }
    const result = validateRemoteNetworkUrl(value, { subject: "更新下载链接" });
    return result.ok ? result.url : null;
}

function releasePageUrl(version: string) {
    return `https://github.com/${RELEASE_REPO}/releases/tag/v${version}`;
}

function plainText(markdown: string) {
    return markdown
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .trim();
}

/**
 * 发布说明是 Markdown。“下载”一节说的是该下哪个文件，对话框里有下载按钮，
 * 不用显示；其余各节（升级前请注意、新功能、改进与修复）的标题和条目逐行显示。
 */
export function releaseNotesToLines(body: unknown): string[] {
    if (typeof body !== "string") {
        return [];
    }
    const lines: string[] = [];
    let skipping = false;
    for (const rawLine of body.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (/^#\s/.test(line)) {
            // 一级标题是“MusicFree vX.Y.Z”，对话框标题里已经有版本号
            continue;
        }
        const heading = /^#{2,6}\s+(.*)$/.exec(line);
        if (heading) {
            const title = plainText(heading[1]);
            skipping = /^(下载|下載|downloads?)$/i.test(title);
            if (!skipping && title) {
                lines.push(`【${title}】`);
            }
            continue;
        }
        if (skipping || !line) {
            continue;
        }
        const bullet = /^[-*+]\s+(.*)$/.exec(line);
        lines.push(bullet ? `· ${plainText(bullet[1])}` : plainText(line));
    }
    return lines.slice(0, MAX_CHANGELOG_LINES);
}

/** 按手机的 CPU 架构挑 APK：先找对应架构的，没有就用通用版 */
function pickApk(assets: unknown, abis: string[]) {
    if (!Array.isArray(assets)) {
        return null;
    }
    const byAbi = new Map<string, string>();
    for (const asset of assets) {
        const name = asset?.name;
        const url = safeUrl(asset?.browser_download_url);
        const abi = typeof name === "string"
            ? /-app-([a-z0-9_-]+)-release\.apk$/i.exec(name)?.[1]
            : undefined;
        if (abi && url) {
            byAbi.set(abi.toLowerCase(), url);
        }
    }
    for (const abi of [...abis, "universal"]) {
        const url = byAbi.get(abi.toLowerCase());
        if (url) {
            return url;
        }
    }
    return null;
}

async function getDeviceAbis() {
    try {
        return await DeviceInfo.supportedAbis();
    } catch {
        return [];
    }
}

async function fetchLatestRelease(): Promise<IUpdateInfo["data"] | null> {
    const response = await updateHttpClient.get(LATEST_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json" },
    });
    const release = response.data as Record<string, unknown> | null;
    if (!release || typeof release !== "object" || release.draft || release.prerelease) {
        return null;
    }
    const version = typeof release.tag_name === "string"
        ? release.tag_name.trim().replace(/^v/i, "")
        : "";
    if (!validate(version)) {
        return null;
    }
    const pageUrl = safeUrl(release.html_url) ?? releasePageUrl(version);
    const apkUrl = pickApk(release.assets, await getDeviceAbis());
    return {
        version,
        changeLog: releaseNotesToLines(release.body),
        // 第一个是“从浏览器下载”（直接下对应架构的 APK），第二个是“备用链接”（发布页面）
        download: apkUrl ? [apkUrl, pageUrl] : [pageUrl],
    };
}

async function fetchLatestTag(): Promise<IUpdateInfo["data"] | null> {
    const response = await updateHttpClient.get(LATEST_TAG_FALLBACK);
    const version = (response.data as { version?: unknown } | null)?.version;
    if (typeof version !== "string" || !validate(version)) {
        return null;
    }
    return {
        version,
        changeLog: [],
        download: [releasePageUrl(version)],
    };
}

/**
 * 有新版本时返回 needUpdate: true 和版本信息；已是最新返回 needUpdate: false；
 * 两个来源都取不到时返回 undefined（手动检查时要告诉用户“检查失败”，而不是“已是最新”）。
 */
export default async function checkUpdate(): Promise<IUpdateInfo | undefined> {
    const currentVersion = DeviceInfo.getVersion();
    for (const source of [fetchLatestRelease, fetchLatestTag]) {
        try {
            const latest = await source();
            if (!latest) {
                continue;
            }
            return compare(latest.version, currentVersion, ">")
                ? { needUpdate: true, data: latest }
                : { needUpdate: false };
        } catch {}
    }
    return undefined;
}

import Base64 from "@/utils/base64";
import { getFileName, removeFileScheme } from "@/utils/fileUtils";

export function getAnonymousStackLocation(stack?: string) {
    if (!stack) {
        return null;
    }
    const match = stack.match(/<anonymous>:(\d+):(\d+)/);
    if (!match) {
        return null;
    }
    const generatedLine = Number(match[1]);
    const column = Number(match[2]);
    const pluginLine = Math.max(1, generatedLine - 4);
    return `位置(估算): 第 ${pluginLine} 行, 第 ${column} 列`;
}

export function formatPluginErrorMessage(error: any) {
    const name = error?.name;
    const message = error?.message ?? String(error ?? "未知错误");
    const title = name && !String(message).startsWith(name)
        ? `${name}: ${message}`
        : String(message);
    const location = getAnonymousStackLocation(error?.stack);
    return location ? `${title}\n${location}` : title;
}

export function formatAuthUrl(url: string) {
    const urlObj = new URL(url);

    try {
        if (urlObj.username && urlObj.password) {
            const auth = `Basic ${Base64.btoa(
                `${decodeURIComponent(urlObj.username)}:${decodeURIComponent(
                    urlObj.password,
                )}`,
            )}`;
            urlObj.username = "";
            urlObj.password = "";

            return {
                url: urlObj.toString(),
                auth,
            };
        }
    } catch {
        return {
            url,
        };
    }
    return {
        url,
    };
}

export function isRemoteMediaUrl(urlLike?: string | null) {
    return typeof urlLike === "string" && /^https?:\/\//i.test(urlLike);
}

export function normalizeLocalFilePath(localPath: string) {
    if (isRemoteMediaUrl(localPath)) {
        return localPath;
    }
    const filePath = removeFileScheme(localPath);
    try {
        return decodeURI(filePath);
    } catch {
        return filePath;
    }
}

export function getRemoteMediaTitle(urlLike: string) {
    const pathWithoutQuery = urlLike.split(/[?#]/)[0];
    const fileName = getFileName(pathWithoutQuery);
    return fileName || urlLike;
}

const localMetadataUnsafeExtensions = new Set([
    ".ape",
    ".asf",
    ".dff",
    ".dsf",
    ".wma",
]);

export function getLowerFileExtension(filePath: string) {
    const pathWithoutQuery = filePath.split("?")[0];
    const slashIndex = Math.max(
        pathWithoutQuery.lastIndexOf("/"),
        pathWithoutQuery.lastIndexOf("\\"),
    );
    const dotIndex = pathWithoutQuery.lastIndexOf(".");
    return dotIndex > slashIndex
        ? pathWithoutQuery.slice(dotIndex).toLowerCase()
        : "";
}

export function shouldReadLocalSystemMetadata(filePath: string) {
    return !localMetadataUnsafeExtensions.has(getLowerFileExtension(filePath));
}

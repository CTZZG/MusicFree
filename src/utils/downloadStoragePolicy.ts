import { classifyStorageUri } from "./storageUri";

interface IResolveDownloadDirectoryOptions {
    platform: string;
    configuredPath?: string | null;
    appScopedRoot: string;
    fallbackPath: string;
}

export function resolveDownloadDirectory({
    platform,
    configuredPath,
    appScopedRoot,
    fallbackPath,
}: IResolveDownloadDirectoryOptions) {
    if (platform !== "android") {
        return configuredPath?.trim() || fallbackPath;
    }
    if (!configuredPath) {
        return fallbackPath;
    }
    const classification = classifyStorageUri(configuredPath, [
        appScopedRoot,
    ]);
    return classification.isAppScoped && classification.filePath
        ? classification.filePath
        : fallbackPath;
}


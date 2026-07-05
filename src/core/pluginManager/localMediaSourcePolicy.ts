export type PluginLocalMediaSourceResolution =
    | {
          type: "remote";
          url: string;
      }
    | {
          type: "local";
          localPath: string;
          url: string;
          patchLocalPath?: string;
      }
    | {
          type: "clear-stale-local-path";
      }
    | {
          type: "missing-local";
      }
    | {
          type: "continue";
      };

export interface PluginLocalMediaSourceInput {
    platform?: string | null;
    localPluginPlatform: string;
    url?: string | null;
    localPath?: string | null;
    localPathInMediaExtra?: string | null;
    normalizedLocalPath?: string | null;
    normalizedLocalPathExists?: boolean;
}

function addPlayableFileScheme(localPath: string) {
    return localPath.startsWith("/") ? `file://${localPath}` : localPath;
}

function isRemoteMediaUrl(urlLike?: string | null) {
    return typeof urlLike === "string" && /^https?:\/\//i.test(urlLike);
}

export function resolvePluginLocalMediaSource({
    platform,
    localPluginPlatform,
    url,
    localPath,
    localPathInMediaExtra,
    normalizedLocalPath,
    normalizedLocalPathExists = false,
}: PluginLocalMediaSourceInput): PluginLocalMediaSourceResolution {
    const remoteMediaUrl = isRemoteMediaUrl(localPath)
        ? localPath
        : platform === localPluginPlatform && isRemoteMediaUrl(url)
            ? url
            : null;

    if (remoteMediaUrl) {
        return {
            type: "remote",
            url: remoteMediaUrl,
        };
    }

    const hasUsableLocalPath =
        !!normalizedLocalPath &&
        (normalizedLocalPath.startsWith("content://") ||
            normalizedLocalPathExists);

    if (hasUsableLocalPath) {
        return {
            type: "local",
            localPath: normalizedLocalPath!,
            url: addPlayableFileScheme(normalizedLocalPath!),
            patchLocalPath:
                localPathInMediaExtra !== normalizedLocalPath
                    ? normalizedLocalPath!
                    : undefined,
        };
    }

    if (localPathInMediaExtra) {
        return {
            type: "clear-stale-local-path",
        };
    }

    if (platform === localPluginPlatform) {
        return {
            type: "missing-local",
        };
    }

    return {
        type: "continue",
    };
}

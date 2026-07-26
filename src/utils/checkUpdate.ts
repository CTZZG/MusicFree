import { compare } from "compare-versions";
import DeviceInfo from "react-native-device-info";
import { validateRemoteNetworkUrl } from "./remoteNetworkPolicy";
import { createRestrictedHttpClient } from "./restrictedHttpClient";

const updateList = [
    "https://gitee.com/maotoumao/MusicFree/raw/master/release/version.json",
    "https://raw.gitcode.com/maotoumao/MusicFree/raw/master/release/version.json",
    "https://raw.githubusercontent.com/maotoumao/MusicFree/master/release/version.json",
    "https://cdn.jsdelivr.net/gh/maotoumao/MusicFree@master/release/version.json",
];

interface IUpdateInfo {
    needUpdate: boolean;
    data: {
        version: string;
        changeLog: string[];
        download: string[];
    };
}

const updateHttpClient = createRestrictedHttpClient({
    maxResponseBytes: 256 * 1024,
    maxTimeoutMs: 8_000,
});

function normalizeUpdateData(value: unknown): IUpdateInfo["data"] | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const raw = value as Record<string, unknown>;
    if (
        typeof raw.version !== "string" ||
        !Array.isArray(raw.changeLog) ||
        !raw.changeLog.every(item => typeof item === "string") ||
        !Array.isArray(raw.download)
    ) {
        return null;
    }

    const download = raw.download
        .filter((item): item is string => typeof item === "string")
        .map(item => validateRemoteNetworkUrl(item, {
            subject: "更新下载链接",
        }))
        .filter(result => result.ok)
        .map(result => result.url);
    if (download.length === 0) {
        return null;
    }

    return {
        version: raw.version,
        changeLog: raw.changeLog,
        download,
    };
}

export default async function checkUpdate(): Promise<IUpdateInfo | undefined> {
    const currentVersion = DeviceInfo.getVersion();
    for (let i = 0; i < updateList.length; ++i) {
        try {
            const response = await updateHttpClient.get(updateList[i]);
            const updateData = normalizeUpdateData(response.data);
            if (
                updateData &&
                compare(updateData.version, currentVersion, ">")
            ) {
                return {
                    needUpdate: true,
                    data: updateData,
                };
            }
        } catch {}
    }
}

import Backup from "@/core/backup";
import Config from "@/core/appConfig";
import { errorLog, trace } from "@/utils/log";
import network from "@/utils/network";
import PersistStatus from "@/utils/persistStatus";
import { AuthType, createClient } from "webdav";

export type IWebdavAutoBackupInterval = "off" | "daily" | "weekly";

const webdavRootPath = "/MusicFree";
const webdavLatestBackupPath = `${webdavRootPath}/MusicFreeBackup.json`;
const webdavHistoryDir = `${webdavRootPath}/Backups`;
const webdavHistoryKeepCount = 10;
const autoBackupIntervalMs: Record<Exclude<IWebdavAutoBackupInterval, "off">, number> = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000,
};

interface IWebdavBackupFile {
    basename?: string;
    filename?: string;
    type?: string;
}

export interface IWebdavBackupCandidate {
    name: string;
    path: string;
    type: "latest" | "history";
}

export interface IWebdavBackupResult {
    latestPath: string;
    historyPath: string;
}

export function formatBackupTimestamp(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-");
}

async function ensureWebdavDirectory(
    client: ReturnType<typeof createClient>,
    path: string,
) {
    if (!(await client.exists(path))) {
        await client.createDirectory(path);
    }
}

function getWebdavBackupFileName(item: IWebdavBackupFile) {
    return item.basename ?? item.filename?.split("/").pop() ?? "";
}

function isWebdavHistoryBackupFile(item: IWebdavBackupFile) {
    return item.type !== "directory" &&
        !!item.filename &&
        getWebdavBackupFileName(item).startsWith("MusicFreeBackup-");
}

function createConfiguredWebdavClient() {
    const username = Config.getConfig("webdav.username");
    const password = Config.getConfig("webdav.password");
    const url = Config.getConfig("webdav.url");

    if (!(username && password && url)) {
        throw new Error("WebDAV settings are incomplete");
    }

    return createClient(url, {
        authType: AuthType.Password,
        username,
        password,
    });
}

function hasConfiguredWebdav() {
    return !!(
        Config.getConfig("webdav.username") &&
        Config.getConfig("webdav.password") &&
        Config.getConfig("webdav.url")
    );
}

async function getWebdavHistoryBackups(
    client: ReturnType<typeof createClient>,
) {
    if (!(await client.exists(webdavHistoryDir))) {
        return [];
    }
    const contents = await client.getDirectoryContents(
        webdavHistoryDir,
    ) as IWebdavBackupFile[];
    return contents
        .filter(isWebdavHistoryBackupFile)
        .sort((a, b) =>
            getWebdavBackupFileName(b)
                .localeCompare(getWebdavBackupFileName(a)),
        );
}

async function pruneWebdavBackupHistory(client: ReturnType<typeof createClient>) {
    try {
        const backupFiles = await getWebdavHistoryBackups(client);

        await Promise.all(
            backupFiles
                .slice(webdavHistoryKeepCount)
                .map(item => item.filename)
                .filter((filename): filename is string => !!filename)
                .map(filename => client.deleteFile(filename)),
        );
    } catch (e) {
        errorLog("清理 WebDAV 备份历史失败", e);
    }
}

export async function backupToWebdav(raw = Backup.backup()): Promise<IWebdavBackupResult> {
    const client = createConfiguredWebdavClient();

    await ensureWebdavDirectory(client, webdavRootPath);
    await ensureWebdavDirectory(client, webdavHistoryDir);

    const historyPath =
        `${webdavHistoryDir}/MusicFreeBackup-${formatBackupTimestamp()}.json`;
    await client.putFileContents(
        historyPath,
        raw,
        {
            overwrite: false,
        },
    );
    await client.putFileContents(
        webdavLatestBackupPath,
        raw,
        {
            overwrite: true,
        },
    );
    await pruneWebdavBackupHistory(client);

    return {
        latestPath: webdavLatestBackupPath,
        historyPath,
    };
}

export async function getWebdavBackupCandidates(): Promise<IWebdavBackupCandidate[]> {
    const client = createConfiguredWebdavClient();
    const candidates: IWebdavBackupCandidate[] = [];

    if (await client.exists(webdavLatestBackupPath)) {
        candidates.push({
            name: "latest",
            path: webdavLatestBackupPath,
            type: "latest",
        });
    }

    const historyBackups = await getWebdavHistoryBackups(client);
    historyBackups.forEach(item => {
        if (item.filename) {
            candidates.push({
                name: getWebdavBackupFileName(item),
                path: item.filename,
                type: "history",
            });
        }
    });

    return candidates;
}

export async function readWebdavBackup(path: string) {
    const client = createConfiguredWebdavClient();
    return client.getFileContents(
        path,
        {
            format: "text",
        },
    ) as Promise<string>;
}

function getAutoBackupInterval() {
    return Config.getConfig("webdav.autoBackupInterval") ?? "off";
}

function getAutoBackupWifiOnly() {
    return Config.getConfig("webdav.autoBackupWifiOnly") ?? true;
}

function getSafeErrorMessage(error: unknown) {
    const rawMessage = error instanceof Error
        ? error.message
        : String(error);
    return rawMessage
        .replace(/https?:\/\/\S+/g, "[url]")
        .replace(/([?&](?:token|access_token|password|pwd|key|secret)=)[^&\s]+/gi, "$1[redacted]")
        .slice(0, 160);
}

function isAutoBackupDue(now = Date.now()) {
    const interval = getAutoBackupInterval();
    if (interval === "off" || !hasConfiguredWebdav()) {
        return false;
    }

    if (getAutoBackupWifiOnly() && !network.isWifi) {
        return false;
    }

    const lastAttempt =
        PersistStatus.get("backup.webdavAutoBackupLastAttemptAt") ?? 0;
    return Math.abs(now - lastAttempt) >= autoBackupIntervalMs[interval];
}

export async function maybeRunAutoWebdavBackup() {
    if (!isAutoBackupDue()) {
        return false;
    }

    const now = Date.now();
    PersistStatus.set("backup.webdavAutoBackupLastAttemptAt", now);

    try {
        const result = await backupToWebdav();
        PersistStatus.set("backup.webdavAutoBackupLastSuccessAt", now);
        PersistStatus.set("backup.webdavAutoBackupLastFailedAt", undefined);
        PersistStatus.set("backup.webdavAutoBackupLastError", undefined);
        trace("WebDAV 自动备份完成", result);
        return true;
    } catch (e) {
        PersistStatus.set("backup.webdavAutoBackupLastFailedAt", Date.now());
        PersistStatus.set(
            "backup.webdavAutoBackupLastError",
            getSafeErrorMessage(e),
        );
        errorLog("WebDAV 自动备份失败", e);
        return false;
    }
}

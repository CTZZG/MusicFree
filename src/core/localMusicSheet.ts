import {
    StorageKeys,
    internalSerializeKey,
    localPluginPlatform,
    supportLocalMediaType,
} from "@/constants/commonConst";
import mp3Util, { IBasicMeta } from "@/native/mp3Util";
import {
    addFileScheme,
    getFileName,
    removeFileScheme,
} from "@/utils/fileUtils.ts";
import {
    getLocalPath,
    getMediaUniqueKey,
    isSameMediaItem,
} from "@/utils/mediaUtils";
import { patchMediaExtra } from "@/utils/mediaExtra";
import { trace } from "@/utils/log";
import StateMapper from "@/utils/stateMapper";
import { getStorage, setStorage } from "@/utils/storage";
import CryptoJs from "crypto-js";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { ReadDirItem, exists, readDir, unlink } from "react-native-fs";
import MusicSheet from "./musicSheet";

let localSheet: IMusic.IMusicItem[] = [];
const localSheetStateMapper = new StateMapper(() => localSheet);
const resumeFailureReasonLimit = 10;

interface ILocalMusicResumeReport {
    successCount: number;
    skippedCount: number;
    failedCount: number;
    failureReasons: string[];
}

type LocalPathStatus = "exists" | "missing" | "unknown";

interface ILocalMusicWeakMatchInfo {
    title: string;
    artist: string;
    album: string;
    duration: number;
}

interface ILocalMusicMatchContext {
    localPathStatusByKey: Map<string, LocalPathStatus>;
    weakCandidates: Array<{
        index: number;
        info: ILocalMusicWeakMatchInfo;
    }>;
}

interface ILocalMusicImportMergeReport {
    addedCount: number;
    exactMatchedCount: number;
    weakMatchedCount: number;
}

const weakMatchDurationToleranceSeconds = 2;
const unknownComparableValues = new Set([
    "unknown",
    "unknown song",
    "unknown title",
    "unknown artist",
    "unknown album",
    "未知",
    "未知歌曲",
    "未知歌手",
    "未知专辑",
    "未知專輯",
]);

function createResumeReport(): ILocalMusicResumeReport {
    return {
        successCount: 0,
        skippedCount: 0,
        failedCount: 0,
        failureReasons: [],
    };
}

export async function setup() {
    const sheet = await getStorage(StorageKeys.LocalMusicSheet);
    if (sheet) {
        localSheet = sheet;
    } else {
        await setStorage(StorageKeys.LocalMusicSheet, []);
    }
    localSheetStateMapper.notify();
}

export async function addMusic(
    musicItem: IMusic.IMusicItem | IMusic.IMusicItem[],
) {
    if (!Array.isArray(musicItem)) {
        musicItem = [musicItem];
    }
    let newSheet = [...localSheet];
    musicItem.forEach(mi => {
        if (newSheet.findIndex(_ => isSameMediaItem(mi, _)) === -1) {
            newSheet.push(mi);
        }
    });
    await setStorage(StorageKeys.LocalMusicSheet, newSheet);
    localSheet = newSheet;
    localSheetStateMapper.notify();
}

function addMusicDraft(musicItem: IMusic.IMusicItem | IMusic.IMusicItem[]) {
    if (!Array.isArray(musicItem)) {
        musicItem = [musicItem];
    }
    let newSheet = [...localSheet];
    musicItem.forEach(mi => {
        if (newSheet.findIndex(_ => isSameMediaItem(mi, _)) === -1) {
            newSheet.push(mi);
        }
    });
    localSheet = newSheet;
    localSheetStateMapper.notify();
}

async function saveLocalSheet() {
    await setStorage(StorageKeys.LocalMusicSheet, localSheet);
}

export async function removeMusic(
    musicItem: IMusic.IMusicItem,
    deleteOriginalFile = false,
) {
    const idx = localSheet.findIndex(_ => isSameMediaItem(_, musicItem));
    let newSheet = [...localSheet];
    if (idx !== -1) {
        const localMusicItem = localSheet[idx];
        newSheet.splice(idx, 1);
        const localPath =
            musicItem[internalSerializeKey]?.localPath ??
            localMusicItem[internalSerializeKey]?.localPath;
        if (deleteOriginalFile && localPath) {
            try {
                await unlink(normalizeFsPath(localPath));
            } catch (e: any) {
                if (e.message !== "File does not exist") {
                    throw e;
                }
            }
        }
    }
    localSheet = newSheet;
    localSheetStateMapper.notify();
    saveLocalSheet();
}

function parseFilename(fn: string): Partial<IMusic.IMusicItem> | null {
    const dotIndex = fn.lastIndexOf(".");
    const basename = dotIndex > 0 ? fn.slice(0, dotIndex) : fn;
    const data = basename.split("@");
    const [platform, id, title, artist] = data;
    if (!platform || !id) {
        const displayName = basename.trim();
        const displayNameMatch = displayName.match(/^(.+?)\s+-\s+(.+)$/);
        if (!displayNameMatch) {
            return null;
        }
        return {
            title: displayNameMatch[1].trim(),
            artist: displayNameMatch[2].trim(),
        };
    }
    return {
        id,
        platform: platform,
        title: title ?? "",
        artist: artist ?? "",
    };
}

function localMediaFilter(filename: string) {
    return supportLocalMediaType.some(ext => filename.toLowerCase().endsWith(ext));
}

function isSupportedLocalMediaFile(filename: string) {
    return localMediaFilter(filename);
}

function normalizeFsPath(filePath: string) {
    const rawPath = removeFileScheme(filePath);
    try {
        return decodeURI(rawPath);
    } catch {
        return rawPath;
    }
}

function normalizeComparableText(value: unknown) {
    return `${value ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ");
}

function isUsefulComparableText(value: string) {
    return !!value && !unknownComparableValues.has(value);
}

function getWeakMatchInfo(
    musicItem: IMusic.IMusicItem,
): ILocalMusicWeakMatchInfo | null {
    const title = normalizeComparableText(musicItem.title);
    const artist = normalizeComparableText(musicItem.artist);
    const album = normalizeComparableText(musicItem.album);
    const durationValue = Number(musicItem.duration);
    const duration = Number.isFinite(durationValue)
        ? Math.max(0, durationValue)
        : 0;

    if (!isUsefulComparableText(title) || !isUsefulComparableText(artist)) {
        return null;
    }
    if (!isUsefulComparableText(album) && !duration) {
        return null;
    }

    return {
        title,
        artist,
        album: isUsefulComparableText(album) ? album : "",
        duration,
    };
}

function isWeakMatch(
    left: ILocalMusicWeakMatchInfo,
    right: ILocalMusicWeakMatchInfo,
) {
    if (left.title !== right.title || left.artist !== right.artist) {
        return false;
    }

    const albumMatched =
        !!left.album && !!right.album && left.album === right.album;
    const durationMatched =
        !!left.duration &&
        !!right.duration &&
        Math.abs(left.duration - right.duration) <=
            weakMatchDurationToleranceSeconds;

    return albumMatched || durationMatched;
}

function isDifferentLocalPath(left: string | null, right: string | null) {
    if (!left || !right) {
        return true;
    }
    return normalizeFsPath(left) !== normalizeFsPath(right);
}

async function resolveLocalPathStatus(
    musicItem: IMusic.IMusicItem,
): Promise<LocalPathStatus> {
    const localPath = getLocalPath(musicItem);
    if (!localPath) {
        return "missing";
    }
    if (localPath.startsWith("content://")) {
        return "unknown";
    }

    return (await exists(normalizeFsPath(localPath)).catch(() => false))
        ? "exists"
        : "missing";
}

const metadataUnsafeExtensions = new Set([
    ".ape",
    ".asf",
    ".dff",
    ".dsf",
    ".wma",
]);

function getLowerFileExtension(filePath: string) {
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

function shouldReadSystemMetadata(filePath: string) {
    return !metadataUnsafeExtensions.has(getLowerFileExtension(filePath));
}

function formatMusicLabel(
    musicItem: Partial<IMusic.IMusicItem> | null | undefined,
) {
    const title = typeof musicItem?.title === "string" && musicItem.title.trim()
        ? musicItem.title.trim()
        : "未知歌曲";
    const artist = typeof musicItem?.artist === "string" && musicItem.artist.trim()
        ? musicItem.artist.trim()
        : "未知歌手";
    return `${title} - ${artist}`;
}

function patchLocalPath(
    musicItem: IMusic.IMusicItem,
    localPath: string,
): IMusic.IMusicItem {
    const shouldPatchUrl =
        typeof musicItem.url === "string" &&
        (musicItem.url.startsWith("file://") ||
            musicItem.url.startsWith("content://"));
    return {
        ...musicItem,
        ...(shouldPatchUrl ? { url: addFileScheme(localPath) } : {}),
        [internalSerializeKey]: {
            ...(musicItem[internalSerializeKey] ?? {}),
            localPath,
        },
    };
}

async function syncLocalMusicPathReferences(musicItem: IMusic.IMusicItem) {
    const localPath = getLocalPath(musicItem);
    if (!localPath) {
        return;
    }

    patchMediaExtra(musicItem, {
        downloaded: true,
        localPath,
    });
    await MusicSheet.updateMusicItemReferences(musicItem, item =>
        patchLocalPath(item, localPath),
    );
}

function pushLimitedReason(reasons: string[], reason: string) {
    if (reasons.length < resumeFailureReasonLimit) {
        reasons.push(reason);
    }
}

let importToken: string | null = null;
// 获取本地的文件列表
async function getMusicStats(folderPaths: string[]) {
    const _importToken = nanoid();
    importToken = _importToken;
    const musicList: string[] = [];
    let peek: string | undefined;
    let dirFiles: ReadDirItem[] = [];
    while (folderPaths.length !== 0) {
        if (importToken !== _importToken) {
            throw new Error("Import Broken");
        }
        peek = folderPaths.shift() as string;
        try {
            dirFiles = await readDir(peek);
        } catch {
            dirFiles = [];
        }

        dirFiles.forEach(item => {
            if (item.isDirectory() && !folderPaths.includes(item.path)) {
                folderPaths.push(item.path);
            } else if (localMediaFilter(item.path)) {
                musicList.push(item.path);
            }
        });
    }

    return { musicList, token: _importToken };
}

function cancelImportLocal() {
    importToken = null;
}

// 导入本地音乐
const groupNum = 25;
async function readMusicMetas(
    musicList: string[],
    token: string,
): Promise<Array<IBasicMeta | null>> {
    const metas: Array<IBasicMeta | null> = Array(musicList.length).fill(null);
    const readableMusicList = musicList
        .map((path, index) => ({ path, index }))
        .filter(item => shouldReadSystemMetadata(item.path));
    const skippedCount = musicList.length - readableMusicList.length;

    if (skippedCount > 0) {
        trace("本地音乐扫描跳过系统元信息读取", {
            skippedCount,
            totalCount: musicList.length,
        });
    }

    const groups = Math.ceil(readableMusicList.length / groupNum);
    for (let i = 0; i < groups; ++i) {
        if (token !== importToken) {
            throw new Error("Import Broken");
        }
        const groupItems = readableMusicList.slice(
            i * groupNum,
            (i + 1) * groupNum,
        );
        try {
            const groupMetas = await mp3Util.getMediaMeta(
                groupItems.map(item => item.path),
            );
            groupItems.forEach((item, index) => {
                metas[item.index] = groupMetas[index] ?? null;
            });
        } catch (e: any) {
            trace("本地音乐扫描读取元信息失败", e?.message ?? String(e), "error");
        }
    }

    return metas;
}

async function createLocalMusicMatchContext(): Promise<ILocalMusicMatchContext> {
    const localPathStatusByKey = new Map<string, LocalPathStatus>();
    const weakCandidates: ILocalMusicMatchContext["weakCandidates"] = [];

    for (let index = 0; index < localSheet.length; index += 1) {
        const musicItem = localSheet[index];
        const status = await resolveLocalPathStatus(musicItem);
        localPathStatusByKey.set(getMediaUniqueKey(musicItem), status);

        if (status !== "missing" || musicItem.platform !== localPluginPlatform) {
            continue;
        }

        const info = getWeakMatchInfo(musicItem);
        if (info) {
            weakCandidates.push({
                index,
                info,
            });
        }
    }

    return {
        localPathStatusByKey,
        weakCandidates,
    };
}

function findUniqueWeakMatchIndex(
    importedMusicItem: IMusic.IMusicItem,
    context: ILocalMusicMatchContext,
    usedWeakMatchIndices: Set<number>,
) {
    if (importedMusicItem.platform !== localPluginPlatform) {
        return -1;
    }

    const importedInfo = getWeakMatchInfo(importedMusicItem);
    if (!importedInfo) {
        return -1;
    }

    let matchedIndex = -1;
    let matchedCount = 0;
    for (const candidate of context.weakCandidates) {
        if (usedWeakMatchIndices.has(candidate.index)) {
            continue;
        }
        if (!isWeakMatch(candidate.info, importedInfo)) {
            continue;
        }

        matchedIndex = candidate.index;
        matchedCount += 1;
        if (matchedCount > 1) {
            return -1;
        }
    }

    return matchedCount === 1 ? matchedIndex : -1;
}

async function mergeImportedMusicItems(
    musicItems: IMusic.IMusicItem[],
    token: string,
): Promise<ILocalMusicImportMergeReport> {
    const report: ILocalMusicImportMergeReport = {
        addedCount: 0,
        exactMatchedCount: 0,
        weakMatchedCount: 0,
    };
    if (!musicItems.length) {
        return report;
    }
    if (token !== importToken) {
        throw new Error("Import Broken");
    }

    const context = await createLocalMusicMatchContext();
    if (token !== importToken) {
        throw new Error("Import Broken");
    }

    const existingIndexByKey = new Map<string, number>();
    localSheet.forEach((musicItem, index) => {
        existingIndexByKey.set(getMediaUniqueKey(musicItem), index);
    });

    const nextSheet = [...localSheet];
    const referenceUpdates: IMusic.IMusicItem[] = [];
    const usedWeakMatchIndices = new Set<number>();
    const itemsToAdd: IMusic.IMusicItem[] = [];

    musicItems.forEach(importedMusicItem => {
        const importedLocalPath = getLocalPath(importedMusicItem);
        const importedKey = getMediaUniqueKey(importedMusicItem);
        const exactMatchIndex = existingIndexByKey.get(importedKey);

        if (exactMatchIndex !== undefined) {
            const existingMusicItem = nextSheet[exactMatchIndex];
            if (
                importedLocalPath &&
                context.localPathStatusByKey.get(importedKey) === "missing" &&
                isDifferentLocalPath(
                    getLocalPath(existingMusicItem),
                    importedLocalPath,
                )
            ) {
                const updatedMusicItem = patchLocalPath(
                    existingMusicItem,
                    importedLocalPath,
                );
                nextSheet[exactMatchIndex] = updatedMusicItem;
                referenceUpdates.push(updatedMusicItem);
                report.exactMatchedCount += 1;
            }
            return;
        }

        const weakMatchIndex = findUniqueWeakMatchIndex(
            importedMusicItem,
            context,
            usedWeakMatchIndices,
        );
        if (weakMatchIndex !== -1 && importedLocalPath) {
            const updatedMusicItem = patchLocalPath(
                nextSheet[weakMatchIndex],
                importedLocalPath,
            );
            nextSheet[weakMatchIndex] = updatedMusicItem;
            usedWeakMatchIndices.add(weakMatchIndex);
            referenceUpdates.push(updatedMusicItem);
            report.weakMatchedCount += 1;
            return;
        }

        itemsToAdd.push(importedMusicItem);
    });

    if (referenceUpdates.length) {
        if (token !== importToken) {
            throw new Error("Import Broken");
        }
        await updateMusicList(nextSheet);
        for (const updatedMusicItem of referenceUpdates) {
            await syncLocalMusicPathReferences(updatedMusicItem);
        }
    }

    if (itemsToAdd.length) {
        if (token !== importToken) {
            throw new Error("Import Broken");
        }
        await addMusic(itemsToAdd);
        report.addedCount = itemsToAdd.length;
    }

    return report;
}

async function importLocal(_folderPaths: string[]) {
    const folderPaths = [..._folderPaths.map(normalizeFsPath)];
    trace("本地音乐扫描开始", {
        folderCount: folderPaths.length,
    });
    const { musicList, token } = await getMusicStats(folderPaths);
    if (token !== importToken) {
        throw new Error("Import Broken");
    }
    trace("本地音乐扫描文件完成", { count: musicList.length });
    const metas = await readMusicMetas(musicList, token);
    if (token !== importToken) {
        throw new Error("Import Broken");
    }
    const musicItems: IMusic.IMusicItem[] = await Promise.all(
        musicList.map(async (musicPath, index) => {
            let { platform, id, title, artist } =
                parseFilename(getFileName(musicPath, true)) ?? {};
            const meta = metas[index];
            if (!platform || !id) {
                platform = "本地";
                id = CryptoJs.MD5(musicPath).toString(CryptoJs.enc.Hex);
            }
            return {
                id,
                platform,
                title: title ?? meta?.title ?? getFileName(musicPath),
                artist: artist ?? meta?.artist ?? "未知歌手",
                duration: parseInt(meta?.duration ?? "0", 10) / 1000,
                album: meta?.album ?? "未知专辑",
                artwork: "",
                [internalSerializeKey]: {
                    localPath: musicPath,
                },
            } as IMusic.IMusicItem;
        }),
    );
    if (token !== importToken) {
        throw new Error("Import Broken");
    }
    const mergeReport = await mergeImportedMusicItems(musicItems, token);
    if (token === importToken) {
        importToken = null;
    }
    trace("本地音乐扫描导入完成", {
        count: musicItems.length,
        addedCount: mergeReport.addedCount,
        exactMatchedCount: mergeReport.exactMatchedCount,
        weakMatchedCount: mergeReport.weakMatchedCount,
    });
    return musicItems;
}

/** 是否为本地音乐 */
function isLocalMusic(
    musicItem: ICommon.IMediaBase | null,
): IMusic.IMusicItem | undefined {
    return musicItem
        ? localSheet.find(_ => isSameMediaItem(_, musicItem))
        : undefined;
}

/** 状态-是否为本地音乐 */
function useIsLocal(musicItem: IMusic.IMusicItem | null) {
    const localMusicState = localSheetStateMapper.useMappedState();
    const [isLocal, setIsLocal] = useState<boolean>(!!isLocalMusic(musicItem));
    useEffect(() => {
        if (!musicItem) {
            setIsLocal(false);
        } else {
            setIsLocal(!!isLocalMusic(musicItem));
        }
    }, [localMusicState, musicItem]);
    return isLocal;
}

function useLocalFileExists(musicItem: IMusic.IMusicItem | null) {
    const localMusicState = localSheetStateMapper.useMappedState();
    const [fileExists, setFileExists] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function checkFileExists() {
            if (!musicItem) {
                setFileExists(null);
                return;
            }
            const localPath = getLocalPath(musicItem);
            if (!localPath) {
                setFileExists(null);
                return;
            }
            const fsPath = normalizeFsPath(localPath);
            const result = await exists(fsPath).catch(() => false);
            if (!cancelled) {
                setFileExists(result);
            }
        }

        checkFileExists();

        return () => {
            cancelled = true;
        };
    }, [localMusicState, musicItem]);

    return fileExists;
}

function getMusicList() {
    return localSheet;
}

async function updateMusicList(newSheet: IMusic.IMusicItem[]) {
    const _localSheet = [...newSheet];
    try {
        await setStorage(StorageKeys.LocalMusicSheet, _localSheet);
        localSheet = _localSheet;
        localSheetStateMapper.notify();
    } catch {}
}

async function relocateMusic(
    musicItem: IMusic.IMusicItem,
    newPath: string,
) {
    const nextLocalPath = normalizeFsPath(newPath);
    if (!isSupportedLocalMediaFile(nextLocalPath)) {
        throw new Error("不支持的音频格式");
    }
    if (!(await exists(nextLocalPath))) {
        throw new Error("文件不存在");
    }

    const targetIndex = localSheet.findIndex(item =>
        isSameMediaItem(item, musicItem),
    );
    if (targetIndex === -1) {
        throw new Error("未找到本地音乐记录");
    }

    const updatedMusicItem = patchLocalPath(localSheet[targetIndex], nextLocalPath);
    const nextSheet = [...localSheet];
    nextSheet[targetIndex] = updatedMusicItem;
    await updateMusicList(nextSheet);
    await syncLocalMusicPathReferences(updatedMusicItem);

    return updatedMusicItem;
}

async function resumeMusicList(
    musicItems?: unknown,
): Promise<ILocalMusicResumeReport> {
    const report = createResumeReport();
    if (!Array.isArray(musicItems) || !musicItems.length) {
        return report;
    }

    const validMusicItems: IMusic.IMusicItem[] = [];
    const skippedReasons: string[] = [];
    for (let musicItem of musicItems) {
        try {
            if (!musicItem || typeof musicItem !== "object") {
                report.skippedCount += 1;
                pushLimitedReason(skippedReasons, "无效本地音乐记录: 已跳过");
                continue;
            }

            const partialMusicItem = musicItem as Partial<IMusic.IMusicItem>;
            const localPath = getLocalPath(partialMusicItem as IMusic.IMusicItem);
            const fsPath = localPath ? normalizeFsPath(localPath) : null;
            if (!fsPath) {
                report.skippedCount += 1;
                pushLimitedReason(
                    skippedReasons,
                    `${formatMusicLabel(partialMusicItem)}: 缺少本地路径`,
                );
            } else if (await exists(fsPath)) {
                validMusicItems.push({
                    ...partialMusicItem,
                    id:
                        partialMusicItem.id ??
                        CryptoJs.MD5(fsPath).toString(CryptoJs.enc.Hex),
                    platform: partialMusicItem.platform ?? localPluginPlatform,
                    title: partialMusicItem.title ?? getFileName(fsPath),
                    artist: partialMusicItem.artist ?? "未知歌手",
                    [internalSerializeKey]: {
                        ...(partialMusicItem[internalSerializeKey] ?? {}),
                        localPath,
                    },
                } as IMusic.IMusicItem);
            } else {
                report.skippedCount += 1;
                pushLimitedReason(
                    skippedReasons,
                    `${formatMusicLabel(partialMusicItem)}: 文件不存在`,
                );
            }
        } catch (e: any) {
            report.skippedCount += 1;
            pushLimitedReason(
                skippedReasons,
                `${formatMusicLabel(musicItem as Partial<IMusic.IMusicItem>)}: ${
                    e?.message ?? String(e)
                }`,
            );
        }
    }

    if (skippedReasons.length) {
        report.failureReasons.push(...skippedReasons);
        const omittedReasonCount = report.skippedCount - skippedReasons.length;
        if (omittedReasonCount > 0) {
            report.failureReasons.push(
                `还有 ${omittedReasonCount} 首本地音乐被跳过`,
            );
        }
    }

    if (validMusicItems.length) {
        try {
            await addMusic(validMusicItems);
            report.successCount = validMusicItems.length;
        } catch (e: any) {
            report.failedCount += validMusicItems.length;
            report.failureReasons.push(e?.message ?? String(e));
        }
    }

    return report;
}

const LocalMusicSheet = {
    setup,
    addMusic,
    removeMusic,
    addMusicDraft,
    saveLocalSheet,
    importLocal,
    cancelImportLocal,
    isLocalMusic,
    isSupportedLocalMediaFile,
    useIsLocal,
    getMusicList,
    useMusicList: localSheetStateMapper.useMappedState,
    useLocalFileExists,
    updateMusicList,
    relocateMusic,
    resumeMusicList,
};

export default LocalMusicSheet;

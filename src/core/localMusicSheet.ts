import {
    StorageKeys,
    internalSerializeKey,
    localPluginPlatform,
    supportLocalMediaType,
} from "@/constants/commonConst";
import mp3Util, { IBasicMeta } from "@/native/mp3Util";
import StorageUri, {
    type IMediaStoreAudioItem,
} from "@/native/storageUri";
import {
    addFileScheme,
    getDirectory,
    getFileName,
    removeFileScheme,
} from "@/utils/fileUtils.ts";
import {
    getLocalPath,
    getMediaUniqueKey,
    isSameMediaItem,
} from "@/utils/mediaUtils";
import { patchMediaExtra } from "@/utils/mediaExtra";
import {
    findLocalMusicItem,
    resolveLocalFileCheckItem,
} from "@/utils/localMusicStatus";
import { localFileExistsResolver } from "@/utils/localFileStatusCache";
import { invalidateLocalMusicArtworkCache } from "./localMusicArtworkManager";
import { errorLog, trace } from "@/utils/log";
import SerializedStateRepository from "@/utils/serializedStateRepository";
import {
    createLocalMusicFileIdentity,
    mergeEditedListWithConcurrentChanges,
    normalizeLocalMusicDurationMilliseconds,
    resolveLocalMusicImportFields,
} from "./localMusicSheetPolicy";
import {
    getLocalMusicScanFilterReason,
    normalizeLocalMusicScanPolicy,
    type ILocalMusicScanPolicy,
    type LocalMusicScanFilterReason,
} from "./localMusicScanPolicy";
import {
    createEmptyLocalMusicMetadataCache,
    getLocalMusicCachedMetadata,
    isUsableLocalMusicMetadata,
    normalizeLocalMusicMetadataCache,
    pruneLocalMusicMetadataCache,
    setLocalMusicCachedMetadata,
    type ILocalMusicMetadataCache,
} from "./localMusicMetadataCache";
import type {
    ILocalMusicImportReport,
    ILocalMusicMetadataIssue,
    ILocalMusicMetadataReadResult,
    ILocalMusicScanCandidate,
    LocalMusicScanProgressListener,
} from "./localMusicScanTypes";
import { resolveEnrichedLocalMusicMetadata } from "./localMusicMetadataFallback";
import StateMapper from "@/utils/stateMapper";
import { getStorage, setStorage, setStorageStrict } from "@/utils/storage";
import CryptoJs from "crypto-js";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import {
    ReadDirItem,
    exists,
    readDir,
    stat,
    unlink,
} from "react-native-fs";
import MusicSheet from "./musicSheet";

let localSheet: IMusic.IMusicItem[] = [];
const localSheetStateMapper = new StateMapper(() => localSheet);
const localSheetRepository = new SerializedStateRepository<IMusic.IMusicItem[]>(
    {
        initialState: localSheet,
        persist: next => setStorageStrict(StorageKeys.LocalMusicSheet, next),
        onCommit(next) {
            localSheet = next;
            localSheetStateMapper.notify();
        },
    },
);
let hiddenMusicKeys = new Set<string>();
let hiddenFolders: string[] = [];
const hiddenStateMapper = new StateMapper(() => ({
    hiddenMusicKeys: [...hiddenMusicKeys],
    hiddenFolders,
}));
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
    localPathByKey: Map<string, string | null>;
    fileIdentityCandidates: Map<string, string[]>;
    weakCandidates: Array<{
        key: string;
        info: ILocalMusicWeakMatchInfo;
    }>;
}

interface ILocalMusicImportMergeReport {
    addedCount: number;
    exactMatchedCount: number;
    weakMatchedCount: number;
    metadataEnrichedCount: number;
}

interface ILocalMusicRelocatePreview {
    currentLabel: string;
    selectedLabel: string;
    needsConfirmation: boolean;
}

const weakMatchDurationToleranceSeconds = 2;
const localFileIdentityKey = "localFileIdentity";
const localMetadataFallbackKey = "localMetadataFallback";
let localMusicMetadataCache: ILocalMusicMetadataCache =
    createEmptyLocalMusicMetadataCache();
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
    if (Array.isArray(sheet)) {
        localSheetRepository.initialize(sheet);
        localSheet = sheet;
    } else {
        await setStorageStrict(StorageKeys.LocalMusicSheet, []);
        localSheetRepository.initialize([]);
        localSheet = [];
    }
    const storedHiddenKeys = await getStorage(StorageKeys.LocalMusicHiddenKeys);
    hiddenMusicKeys = new Set(
        Array.isArray(storedHiddenKeys)
            ? storedHiddenKeys.filter(item => typeof item === "string")
            : [],
    );
    const storedHiddenFolders = await getStorage(
        StorageKeys.LocalMusicHiddenFolders,
    );
    hiddenFolders = Array.isArray(storedHiddenFolders)
        ? storedHiddenFolders
            .filter(item => typeof item === "string")
            .map(normalizeFolderPath)
        : [];
    localMusicMetadataCache = normalizeLocalMusicMetadataCache(
        await getStorage(StorageKeys.LocalMusicMetadataCache),
    );
    localSheetStateMapper.notify();
    hiddenStateMapper.notify();
}

export async function addMusic(
    musicItem: IMusic.IMusicItem | IMusic.IMusicItem[],
) {
    const musicItems = Array.isArray(musicItem) ? musicItem : [musicItem];
    musicItems.forEach(item => {
        const localPath = getLocalPath(item);
        if (localPath) {
            localFileExistsResolver.invalidate(normalizeFsPath(localPath));
            invalidateLocalMusicArtworkCache(localPath);
        }
    });
    let addedCount = 0;
    await localSheetRepository.mutate(current => {
        const newSheet = [...current];
        musicItems.forEach(mi => {
            if (newSheet.findIndex(_ => isSameMediaItem(mi, _)) === -1) {
                newSheet.push(mi);
            }
        });
        addedCount = newSheet.length - current.length;
        return newSheet.length === current.length ? current : newSheet;
    });
    return addedCount;
}

async function upsertMusic(musicItem: IMusic.IMusicItem) {
    const previousMusicItem = localSheet.find(item =>
        isSameMediaItem(item, musicItem),
    );
    const previousLocalPath = previousMusicItem
        ? getLocalPath(previousMusicItem)
        : null;
    const nextLocalPath = getLocalPath(musicItem);
    [previousLocalPath, nextLocalPath].forEach(localPath => {
        if (localPath) {
            localFileExistsResolver.invalidate(normalizeFsPath(localPath));
            invalidateLocalMusicArtworkCache(localPath);
        }
    });
    await localSheetRepository.mutate(current => {
        const idx = current.findIndex(item => isSameMediaItem(item, musicItem));
        if (idx === -1) {
            return [...current, musicItem];
        }
        const newSheet = [...current];
        newSheet[idx] = musicItem;
        return newSheet;
    });
}
function addMusicDraft(musicItem: IMusic.IMusicItem | IMusic.IMusicItem[]) {
    return addMusic(musicItem);
}

async function saveLocalSheet() {
    await localSheetRepository.flush();
}

export async function removeMusic(
    musicItem: IMusic.IMusicItem,
    deleteOriginalFile = false,
) {
    let removedLocalPath: string | undefined;
    let removedMusicItem: IMusic.IMusicItem | undefined;
    let removedIndex = -1;
    await localSheetRepository.mutate(current => {
        const idx = current.findIndex(_ => isSameMediaItem(_, musicItem));
        if (idx === -1) {
            return current;
        }

        const localMusicItem = current[idx];
        removedMusicItem = localMusicItem;
        removedIndex = idx;
        removedLocalPath =
            musicItem[internalSerializeKey]?.localPath ??
            localMusicItem[internalSerializeKey]?.localPath;
        const newSheet = [...current];
        newSheet.splice(idx, 1);
        return newSheet;
    });

    if (deleteOriginalFile && removedLocalPath) {
        try {
            if (removedLocalPath.startsWith("content://")) {
                if (!await StorageUri.delete(removedLocalPath)) {
                    throw new Error("Unable to delete the selected document");
                }
            } else {
                await unlink(normalizeFsPath(removedLocalPath));
            }
        } catch (e: any) {
            if (e.message !== "File does not exist" && removedMusicItem) {
                await localSheetRepository
                    .mutate(current => {
                        if (
                            current.some(item =>
                                isSameMediaItem(item, removedMusicItem!),
                            )
                        ) {
                            return current;
                        }
                        const next = [...current];
                        next.splice(
                            Math.min(Math.max(removedIndex, 0), next.length),
                            0,
                            removedMusicItem!,
                        );
                        return next;
                    })
                    .catch(restoreError => {
                        errorLog(
                            "删除本地文件失败后恢复音乐索引失败",
                            restoreError,
                        );
                    });
                throw e;
            }
        }
    }
    if (removedLocalPath) {
        localFileExistsResolver.invalidate(normalizeFsPath(removedLocalPath));
        invalidateLocalMusicArtworkCache(removedLocalPath);
    }
}

async function removeMusicIfLocalPath(
    musicItem: IMusic.IMusicItem,
    expectedLocalPath: string,
) {
    const normalizedExpectedPath = normalizeFsPath(expectedLocalPath);
    let removed = false;
    await localSheetRepository.mutate(current => {
        const idx = current.findIndex(item => isSameMediaItem(item, musicItem));
        if (idx === -1) {
            return current;
        }
        const currentLocalPath = getLocalPath(current[idx]);
        if (
            !currentLocalPath ||
            normalizeFsPath(currentLocalPath) !== normalizedExpectedPath
        ) {
            return current;
        }

        const newSheet = [...current];
        newSheet.splice(idx, 1);
        removed = true;
        return newSheet;
    });
    return removed;
}
function localMediaFilter(filename: string) {
    return supportLocalMediaType.some(ext =>
        filename.toLowerCase().endsWith(ext),
    );
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

function normalizeFolderPath(folderPath: string) {
    const normalizedPath = normalizeFsPath(folderPath).replace(/\\/g, "/");
    return normalizedPath.replace(/\/+$/, "");
}

function getLocalMusicFolder(musicItem: IMusic.IMusicItem) {
    const localPath = getLocalPath(musicItem);
    if (!localPath || localPath.startsWith("content://")) {
        return "";
    }
    return normalizeFolderPath(getDirectory(normalizeFsPath(localPath)));
}

function isPathInHiddenFolder(localPath: string | null) {
    if (!localPath || localPath.startsWith("content://")) {
        return false;
    }
    const normalizedPath = normalizeFsPath(localPath).replace(/\\/g, "/");
    return hiddenFolders.some(folder => {
        const normalizedFolder = normalizeFolderPath(folder);
        return (
            normalizedPath === normalizedFolder ||
            normalizedPath.startsWith(`${normalizedFolder}/`)
        );
    });
}

function isHiddenMusic(musicItem: IMusic.IMusicItem) {
    return (
        hiddenMusicKeys.has(getMediaUniqueKey(musicItem)) ||
        isPathInHiddenFolder(getLocalPath(musicItem))
    );
}

function useIsHidden(musicItem: IMusic.IMusicItem | null) {
    const hiddenState = hiddenStateMapper.useMappedState();
    return useMemo(() => {
        if (!musicItem) {
            return false;
        }
        return isHiddenMusic(musicItem);
    }, [hiddenState, musicItem]);
}

async function saveHiddenState() {
    hiddenFolders = [...new Set(hiddenFolders.map(normalizeFolderPath))];
    await Promise.all([
        setStorage(StorageKeys.LocalMusicHiddenKeys, [...hiddenMusicKeys]),
        setStorage(StorageKeys.LocalMusicHiddenFolders, hiddenFolders),
    ]);
    hiddenStateMapper.notify();
    localSheetStateMapper.notify();
}

async function hideMusic(musicItem: IMusic.IMusicItem) {
    hiddenMusicKeys.add(getMediaUniqueKey(musicItem));
    await saveHiddenState();
}

async function unhideMusic(musicItem: IMusic.IMusicItem) {
    hiddenMusicKeys.delete(getMediaUniqueKey(musicItem));
    await saveHiddenState();
}

async function hideFolder(folderPath: string) {
    const normalizedFolder = normalizeFolderPath(folderPath);
    if (!normalizedFolder) {
        return;
    }
    if (!hiddenFolders.includes(normalizedFolder)) {
        hiddenFolders = [...hiddenFolders, normalizedFolder];
        await saveHiddenState();
    }
}

async function unhideFolder(folderPath: string) {
    const normalizedFolder = normalizeFolderPath(folderPath);
    const nextFolders = hiddenFolders.filter(
        folder => normalizeFolderPath(folder) !== normalizedFolder,
    );
    if (nextFolders.length !== hiddenFolders.length) {
        hiddenFolders = nextFolders;
        await saveHiddenState();
    }
}

function useHiddenState() {
    return hiddenStateMapper.useMappedState();
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

function isComparableTextClose(left: unknown, right: unknown) {
    const normalizedLeft = normalizeComparableText(left);
    const normalizedRight = normalizeComparableText(right);
    if (
        !isUsefulComparableText(normalizedLeft) ||
        !isUsefulComparableText(normalizedRight)
    ) {
        return null;
    }
    return (
        normalizedLeft === normalizedRight ||
        normalizedLeft.includes(normalizedRight) ||
        normalizedRight.includes(normalizedLeft)
    );
}

function isDifferentLocalPath(left: string | null, right: string | null) {
    if (!left || !right) {
        return true;
    }
    return normalizeFsPath(left) !== normalizeFsPath(right);
}

function isSameLocalPath(left: string | null, right: string | null) {
    if (!left || !right) {
        return left === right;
    }
    return normalizeFsPath(left) === normalizeFsPath(right);
}

async function resolveLocalPathStatus(
    musicItem: IMusic.IMusicItem,
): Promise<LocalPathStatus> {
    const localPath = getLocalPath(musicItem);
    if (!localPath) {
        return "missing";
    }
    if (localPath.startsWith("content://")) {
        return (await StorageUri.exists(localPath).catch(() => false))
            ? "exists"
            : "missing";
    }

    return (await exists(normalizeFsPath(localPath)).catch(() => false))
        ? "exists"
        : "missing";
}

function getStoredLocalFileIdentity(
    musicItem: IMusic.IMusicItem,
): string | null {
    const value = musicItem[internalSerializeKey]?.[localFileIdentityKey];
    return typeof value === "string" && value ? value : null;
}

interface ILocalMetadataFallbackSnapshot {
    title: string;
    artist: string;
    duration: number;
    album: string;
}

function getLocalMetadataFallbackSnapshot(
    musicItem: IMusic.IMusicItem,
): ILocalMetadataFallbackSnapshot | null {
    const value = musicItem[internalSerializeKey]?.[localMetadataFallbackKey];
    return value && typeof value === "object"
        ? value as ILocalMetadataFallbackSnapshot
        : null;
}

function enrichLocalMetadataFallback(
    existingMusicItem: IMusic.IMusicItem,
    importedMusicItem: IMusic.IMusicItem,
) {
    if (
        !getLocalMetadataFallbackSnapshot(existingMusicItem) ||
        getLocalMetadataFallbackSnapshot(importedMusicItem)
    ) {
        return null;
    }
    const fallback = getLocalMetadataFallbackSnapshot(existingMusicItem)!;
    const nextInternal = {
        ...(existingMusicItem[internalSerializeKey] ?? {}),
        ...(importedMusicItem[internalSerializeKey] ?? {}),
    };
    delete nextInternal[localMetadataFallbackKey];
    // A fallback import is explicitly owned by this scanner, so replacing its
    // placeholder fields is safe. Preserve identity and playback references.
    const enrichedFields = resolveEnrichedLocalMusicMetadata(
        existingMusicItem,
        fallback,
        importedMusicItem,
    );
    return {
        ...existingMusicItem,
        ...enrichedFields,
        artwork: existingMusicItem.artwork || importedMusicItem.artwork,
        [internalSerializeKey]: nextInternal,
    } as IMusic.IMusicItem;
}

async function resolveLocalFileIdentity(
    musicItem: IMusic.IMusicItem,
    status: LocalPathStatus,
) {
    const storedIdentity = getStoredLocalFileIdentity(musicItem);
    if (storedIdentity) {
        return storedIdentity;
    }
    if (status !== "exists") {
        return null;
    }

    const localPath = getLocalPath(musicItem);
    if (!localPath) {
        return null;
    }
    try {
        const metadata = localPath.startsWith("content://")
            ? await StorageUri.getMetadata(localPath)
            : {
                displayName: getFileName(localPath, true),
                size: Number((await stat(normalizeFsPath(localPath))).size),
            };
        const durationSeconds = Number(musicItem.duration);
        return createLocalMusicFileIdentity({
            displayName: metadata.displayName,
            size: metadata.size,
            durationMilliseconds: Number.isFinite(durationSeconds)
                ? durationSeconds * 1000
                : null,
            title: musicItem.title,
            artist: musicItem.artist,
            album: musicItem.album,
        });
    } catch {
        return null;
    }
}

async function readMusicMeta(musicPath: string) {
    try {
        // 原生侧会按格式选择安全的读取器（MediaMetadataRetriever / jaudiotagger）
        const metas = await mp3Util.getMediaMeta([musicPath]);
        return metas[0] ?? null;
    } catch (e: any) {
        trace("本地音乐读取元信息失败", e?.message ?? String(e));
        return null;
    }
}

function formatMusicLabel(
    musicItem: Partial<IMusic.IMusicItem> | null | undefined,
) {
    const title =
        typeof musicItem?.title === "string" && musicItem.title.trim()
            ? musicItem.title.trim()
            : "未知歌曲";
    const artist =
        typeof musicItem?.artist === "string" && musicItem.artist.trim()
            ? musicItem.artist.trim()
            : "未知歌手";
    return `${title} - ${artist}`;
}

function patchLocalPath(
    musicItem: IMusic.IMusicItem,
    localPath: string,
    localFileIdentity?: string | null,
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
            ...(localFileIdentity
                ? { [localFileIdentityKey]: localFileIdentity }
                : {}),
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

async function syncLocalMusicMetadataReferences(
    musicItem: IMusic.IMusicItem,
    fallback: ILocalMetadataFallbackSnapshot,
) {
    await MusicSheet.updateMusicItemReferences(musicItem, item => {
        const nextInternal = {
            ...(item[internalSerializeKey] ?? {}),
            ...(musicItem[internalSerializeKey] ?? {}),
        };
        delete nextInternal[localMetadataFallbackKey];
        return {
            ...item,
            ...resolveEnrichedLocalMusicMetadata(item, fallback, musicItem),
            artwork: item.artwork || musicItem.artwork,
            [internalSerializeKey]: nextInternal,
        };
    });
}

function pushLimitedReason(reasons: string[], reason: string) {
    if (reasons.length < resumeFailureReasonLimit) {
        reasons.push(reason);
    }
}

let importToken: string | null = null;
// 获取本地的文件列表
async function getMusicCandidates(
    folderPaths: string[],
    onProgress?: LocalMusicScanProgressListener,
) {
    const _importToken = nanoid();
    importToken = _importToken;
    const candidates: ILocalMusicScanCandidate[] = [];
    let peek: string | undefined;
    let dirFiles: ReadDirItem[] = [];
    try {
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
                    const size = Number(item.size);
                    candidates.push({
                        musicPath: item.path,
                        displayName: item.name,
                        size: Number.isFinite(size) && size >= 0
                            ? size
                            : undefined,
                        modifiedAt:
                            item.mtime instanceof Date
                                ? item.mtime.getTime()
                                : null,
                    });
                }
            });
            onProgress?.({
                stage: "discovering",
                completed: candidates.length,
                total: 0,
                cachedMetadataCount: 0,
                metadataWarningCount: 0,
            });
        }
    } catch (error) {
        if (importToken === _importToken) {
            importToken = null;
        }
        throw error;
    }

    return { candidates, token: _importToken };
}

function cancelImportLocal() {
    importToken = null;
    if (Platform.OS === "android") {
        try {
            StorageUri.cancelDirectoryScan();
        } catch (error: any) {
            trace(
                "取消 SAF 目录扫描失败",
                error?.message ?? String(error),
            );
        }
    }
}

// 导入本地音乐
const groupNum = 25;
async function readMusicMetas(
    candidates: ILocalMusicScanCandidate[],
    token: string,
    onProgress?: LocalMusicScanProgressListener,
): Promise<ILocalMusicMetadataReadResult> {
    const metas: Array<IBasicMeta | null> = Array(candidates.length).fill(null);
    const issues: ILocalMusicMetadataIssue[] = [];
    const uncached: Array<{
        candidate: ILocalMusicScanCandidate;
        index: number;
    }> = [];
    let cachedCount = 0;

    candidates.forEach((candidate, index) => {
        const cached = getLocalMusicCachedMetadata(
            localMusicMetadataCache,
            candidate,
        );
        if (cached) {
            metas[index] = cached;
            cachedCount += 1;
        } else {
            uncached.push({ candidate, index });
        }
    });
    // 原生侧会按格式选择安全的读取器，无需在 JS 侧按扩展名跳过
    const groups = Math.ceil(uncached.length / groupNum);
    let completed = cachedCount;
    let cacheChanged = false;
    const reportProgress = () => onProgress?.({
        stage: "reading-metadata",
        completed,
        total: candidates.length,
        cachedMetadataCount: cachedCount,
        metadataWarningCount: issues.length,
    });
    reportProgress();
    for (let i = 0; i < groups; ++i) {
        if (token !== importToken) {
            throw new Error("Import Broken");
        }
        const groupItems = uncached.slice(
            i * groupNum,
            (i + 1) * groupNum,
        );
        try {
            const groupMetas = await mp3Util.getMediaMeta(
                groupItems.map(item => item.candidate.musicPath),
            );
            groupItems.forEach((item, index) => {
                const metadata = groupMetas[index] ?? null;
                metas[item.index] = metadata;
                if (isUsableLocalMusicMetadata(metadata)) {
                    if (setLocalMusicCachedMetadata(
                        localMusicMetadataCache,
                        item.candidate,
                        metadata!,
                    )) {
                        cacheChanged = true;
                    }
                } else {
                    issues.push({
                        candidate: item.candidate,
                        message: "未读取到可用元数据",
                    });
                }
            });
        } catch (e: any) {
            const groupMessage = e?.message ?? String(e);
            // A single malformed file must not poison the entire native batch.
            // Retry each candidate to isolate the actionable failures.
            for (const item of groupItems) {
                if (token !== importToken) {
                    throw new Error("Import Broken");
                }
                try {
                    const result = await mp3Util.getMediaMeta([
                        item.candidate.musicPath,
                    ]);
                    const metadata = result[0] ?? null;
                    metas[item.index] = metadata;
                    if (isUsableLocalMusicMetadata(metadata)) {
                        if (setLocalMusicCachedMetadata(
                            localMusicMetadataCache,
                            item.candidate,
                            metadata!,
                        )) {
                            cacheChanged = true;
                        }
                    } else {
                        issues.push({
                            candidate: item.candidate,
                            message: "未读取到可用元数据",
                        });
                    }
                } catch (itemError: any) {
                    issues.push({
                        candidate: item.candidate,
                        message:
                            typeof itemError?.message === "string" &&
                            itemError.message
                                ? itemError.message
                                : groupMessage || String(itemError),
                    });
                }
            }
        }
        completed += groupItems.length;
        reportProgress();
    }

    if (cacheChanged && token === importToken) {
        await setStorage(
            StorageKeys.LocalMusicMetadataCache,
            pruneLocalMusicMetadataCache(localMusicMetadataCache),
        );
    }
    return {
        metadata: metas,
        issues,
        cachedCount,
        readCount: uncached.length,
    };
}

async function createLocalMusicItemFromPath(
    musicPath: string,
): Promise<IMusic.IMusicItem> {
    const normalizedPath = normalizeFsPath(musicPath);
    const meta = await readMusicMeta(normalizedPath);
    const fields = resolveLocalMusicImportFields({
        filename: getFileName(normalizedPath, true),
        embeddedMetadata: meta,
        fallbackTitle: getFileName(normalizedPath),
        fallbackArtist: "未知歌手",
    });
    const duration =
        normalizeLocalMusicDurationMilliseconds(meta?.duration) / 1000;

    return {
        id:
            fields.id ??
            CryptoJs.MD5(normalizedPath).toString(CryptoJs.enc.Hex),
        platform: fields.platform ?? localPluginPlatform,
        title: fields.title,
        artist: fields.artist,
        duration: Number.isFinite(duration) ? duration : 0,
        album: meta?.album ?? "未知专辑",
        artwork: "",
        [internalSerializeKey]: {
            localPath: normalizedPath,
        },
    } as IMusic.IMusicItem;
}

async function createLocalMusicMatchContext(
    snapshot: readonly IMusic.IMusicItem[],
): Promise<ILocalMusicMatchContext> {
    const localPathStatusByKey = new Map<string, LocalPathStatus>();
    const localPathByKey = new Map<string, string | null>();
    const fileIdentityCandidates = new Map<string, string[]>();
    const weakCandidates: ILocalMusicMatchContext["weakCandidates"] = [];

    for (const musicItem of snapshot) {
        const key = getMediaUniqueKey(musicItem);
        const status = await resolveLocalPathStatus(musicItem);
        localPathStatusByKey.set(key, status);
        localPathByKey.set(key, getLocalPath(musicItem));

        if (musicItem.platform === localPluginPlatform) {
            const fileIdentity = await resolveLocalFileIdentity(
                musicItem,
                status,
            );
            if (fileIdentity) {
                const candidates =
                    fileIdentityCandidates.get(fileIdentity) ?? [];
                candidates.push(key);
                fileIdentityCandidates.set(fileIdentity, candidates);
            }
        }

        if (
            status !== "missing" ||
            musicItem.platform !== localPluginPlatform
        ) {
            continue;
        }

        const info = getWeakMatchInfo(musicItem);
        if (info) {
            weakCandidates.push({
                key: getMediaUniqueKey(musicItem),
                info,
            });
        }
    }

    return {
        localPathStatusByKey,
        localPathByKey,
        fileIdentityCandidates,
        weakCandidates,
    };
}

function findUniqueFileIdentityMatchKey(
    importedMusicItem: IMusic.IMusicItem,
    context: ILocalMusicMatchContext,
    usedMatchKeys: ReadonlySet<string>,
    availableKeys: ReadonlySet<string>,
) {
    const fileIdentity = getStoredLocalFileIdentity(importedMusicItem);
    if (!fileIdentity) {
        return null;
    }
    const candidates = context.fileIdentityCandidates.get(fileIdentity) ?? [];
    const availableCandidates = candidates.filter(
        key => !usedMatchKeys.has(key) && availableKeys.has(key),
    );
    return availableCandidates.length === 1
        ? availableCandidates[0]
        : null;
}

function findUniqueWeakMatchKey(
    importedMusicItem: IMusic.IMusicItem,
    context: ILocalMusicMatchContext,
    usedWeakMatchKeys: Set<string>,
    availableKeys: ReadonlySet<string>,
) {
    if (importedMusicItem.platform !== localPluginPlatform) {
        return null;
    }

    const importedInfo = getWeakMatchInfo(importedMusicItem);
    if (!importedInfo) {
        return null;
    }

    let matchedKey: string | null = null;
    let matchedCount = 0;
    for (const candidate of context.weakCandidates) {
        if (
            usedWeakMatchKeys.has(candidate.key) ||
            !availableKeys.has(candidate.key)
        ) {
            continue;
        }
        if (!isWeakMatch(candidate.info, importedInfo)) {
            continue;
        }

        matchedKey = candidate.key;
        matchedCount += 1;
        if (matchedCount > 1) {
            return null;
        }
    }

    return matchedCount === 1 ? matchedKey : null;
}

async function mergeImportedMusicItems(
    musicItems: IMusic.IMusicItem[],
    token: string,
): Promise<ILocalMusicImportMergeReport> {
    const report: ILocalMusicImportMergeReport = {
        addedCount: 0,
        exactMatchedCount: 0,
        weakMatchedCount: 0,
        metadataEnrichedCount: 0,
    };
    if (!musicItems.length) {
        return report;
    }
    if (token !== importToken) {
        throw new Error("Import Broken");
    }

    // File checks are intentionally performed outside the mutation queue, but
    // the snapshot is stable and only supplies match hints. The actual merge
    // below always uses the latest committed repository state.
    const matchSnapshot = [...localSheet];
    const context = await createLocalMusicMatchContext(matchSnapshot);
    if (token !== importToken) {
        throw new Error("Import Broken");
    }

    const referenceUpdates = new Map<string, IMusic.IMusicItem>();
    const metadataReferenceUpdates = new Map<
        string,
        { musicItem: IMusic.IMusicItem; fallback: ILocalMetadataFallbackSnapshot }
    >();
    await localSheetRepository.mutate(current => {
        if (token !== importToken) {
            throw new Error("Import Broken");
        }

        const nextSheet = [...current];
        const existingIndexByKey = new Map<string, number>();
        const existingIndexByLocalPath = new Map<string, number>();
        nextSheet.forEach((musicItem, index) => {
            existingIndexByKey.set(getMediaUniqueKey(musicItem), index);
            const localPath = getLocalPath(musicItem);
            if (localPath) {
                existingIndexByLocalPath.set(normalizeFsPath(localPath), index);
            }
        });
        const usedWeakMatchKeys = new Set<string>();
        const usedFileIdentityMatchKeys = new Set<string>();
        const availableFileIdentityMatchKeys = new Set<string>();
        context.fileIdentityCandidates.forEach(candidateKeys => {
            candidateKeys.forEach(candidateKey => {
                const currentIndex = existingIndexByKey.get(candidateKey);
                if (
                    currentIndex !== undefined &&
                    isSameLocalPath(
                        getLocalPath(nextSheet[currentIndex]),
                        context.localPathByKey.get(candidateKey) ?? null,
                    )
                ) {
                    availableFileIdentityMatchKeys.add(candidateKey);
                }
            });
        });
        const availableWeakMatchKeys = new Set(
            context.weakCandidates
                .filter(candidate => {
                    const currentIndex = existingIndexByKey.get(candidate.key);
                    return (
                        currentIndex !== undefined &&
                        isSameLocalPath(
                            getLocalPath(nextSheet[currentIndex]),
                            context.localPathByKey.get(candidate.key) ?? null,
                        )
                    );
                })
                .map(candidate => candidate.key),
        );
        let changed = false;

        musicItems.forEach(importedMusicItem => {
            const importedLocalPath = getLocalPath(importedMusicItem);
            const importedFileIdentity =
                getStoredLocalFileIdentity(importedMusicItem);
            const importedKey = getMediaUniqueKey(importedMusicItem);
            const samePathIndex = importedLocalPath
                ? existingIndexByLocalPath.get(
                    normalizeFsPath(importedLocalPath),
                )
                : undefined;
            if (samePathIndex !== undefined) {
                const fallback = getLocalMetadataFallbackSnapshot(
                    nextSheet[samePathIndex],
                );
                const enrichedMusicItem = enrichLocalMetadataFallback(
                    nextSheet[samePathIndex],
                    importedMusicItem,
                );
                if (enrichedMusicItem && fallback) {
                    const previousKey = getMediaUniqueKey(
                        nextSheet[samePathIndex],
                    );
                    nextSheet[samePathIndex] = enrichedMusicItem;
                    metadataReferenceUpdates.set(previousKey, {
                        musicItem: enrichedMusicItem,
                        fallback,
                    });
                    report.metadataEnrichedCount += 1;
                    changed = true;
                }
                return;
            }
            const exactMatchIndex = existingIndexByKey.get(importedKey);

            if (exactMatchIndex !== undefined) {
                const existingMusicItem = nextSheet[exactMatchIndex];
                if (
                    importedLocalPath &&
                    context.localPathStatusByKey.get(importedKey) ===
                        "missing" &&
                    isSameLocalPath(
                        getLocalPath(existingMusicItem),
                        context.localPathByKey.get(importedKey) ?? null,
                    ) &&
                    isDifferentLocalPath(
                        getLocalPath(existingMusicItem),
                        importedLocalPath,
                    )
                ) {
                    const updatedMusicItem = patchLocalPath(
                        existingMusicItem,
                        importedLocalPath,
                        importedFileIdentity,
                    );
                    nextSheet[exactMatchIndex] = updatedMusicItem;
                    referenceUpdates.set(importedKey, updatedMusicItem);
                    report.exactMatchedCount += 1;
                    changed = true;
                }
                return;
            }

            const fileIdentityMatchKey = findUniqueFileIdentityMatchKey(
                importedMusicItem,
                context,
                usedFileIdentityMatchKeys,
                availableFileIdentityMatchKeys,
            );
            const fileIdentityMatchIndex = fileIdentityMatchKey
                ? existingIndexByKey.get(fileIdentityMatchKey)
                : undefined;
            if (
                fileIdentityMatchKey &&
                fileIdentityMatchIndex !== undefined
            ) {
                if (
                    importedLocalPath &&
                    context.localPathStatusByKey.get(
                        fileIdentityMatchKey,
                    ) === "missing"
                ) {
                    const updatedMusicItem = patchLocalPath(
                        nextSheet[fileIdentityMatchIndex],
                        importedLocalPath,
                        importedFileIdentity,
                    );
                    nextSheet[fileIdentityMatchIndex] = updatedMusicItem;
                    referenceUpdates.set(
                        fileIdentityMatchKey,
                        updatedMusicItem,
                    );
                    report.exactMatchedCount += 1;
                    changed = true;
                }
                usedFileIdentityMatchKeys.add(fileIdentityMatchKey);
                return;
            }

            const weakMatchKey = findUniqueWeakMatchKey(
                importedMusicItem,
                context,
                usedWeakMatchKeys,
                availableWeakMatchKeys,
            );
            const weakMatchIndex = weakMatchKey
                ? existingIndexByKey.get(weakMatchKey)
                : undefined;
            if (
                weakMatchKey &&
                weakMatchIndex !== undefined &&
                importedLocalPath
            ) {
                const updatedMusicItem = patchLocalPath(
                    nextSheet[weakMatchIndex],
                    importedLocalPath,
                    importedFileIdentity,
                );
                nextSheet[weakMatchIndex] = updatedMusicItem;
                usedWeakMatchKeys.add(weakMatchKey);
                referenceUpdates.set(weakMatchKey, updatedMusicItem);
                report.weakMatchedCount += 1;
                changed = true;
                return;
            }

            existingIndexByKey.set(importedKey, nextSheet.length);
            if (importedLocalPath) {
                existingIndexByLocalPath.set(
                    normalizeFsPath(importedLocalPath),
                    nextSheet.length,
                );
            }
            nextSheet.push(importedMusicItem);
            report.addedCount += 1;
            changed = true;
        });

        return changed ? nextSheet : current;
    });

    for (const updatedMusicItem of referenceUpdates.values()) {
        await syncLocalMusicPathReferences(updatedMusicItem);
    }
    for (const update of metadataReferenceUpdates.values()) {
        await syncLocalMusicMetadataReferences(
            update.musicItem,
            update.fallback,
        );
    }

    return report;
}

async function importMusicCandidates(
    candidates: ILocalMusicScanCandidate[],
    token: string,
    scanPolicyValue?: ILocalMusicScanPolicy,
    onProgress?: LocalMusicScanProgressListener,
    discoveryMs = 0,
) {
    const startedAt = Date.now() - discoveryMs;
    if (token !== importToken) {
        throw new Error("Import Broken");
    }
    const scanPolicy = normalizeLocalMusicScanPolicy(scanPolicyValue);
    const filterCounts: Record<LocalMusicScanFilterReason, number> = {
        "file-size": 0,
        duration: 0,
        "likely-system-sound": 0,
    };
    const filteredItems: ILocalMusicImportReport["filteredItems"] = [];
    const countFilterReason = (reason: LocalMusicScanFilterReason | null) => {
        if (reason) {
            filterCounts[reason] += 1;
        }
    };
    const metadataCandidates = candidates.filter(candidate => {
        const reason = getLocalMusicScanFilterReason(
            candidate,
            null,
            scanPolicy,
        );
        countFilterReason(reason);
        if (reason) {
            filteredItems.push({ candidate, reason });
        }
        return !reason;
    });
    onProgress?.({
        stage: "filtering",
        completed: candidates.length,
        total: candidates.length,
        cachedMetadataCount: 0,
        metadataWarningCount: 0,
    });
    trace("本地音乐扫描文件完成", {
        candidateCount: candidates.length,
        metadataCandidateCount: metadataCandidates.length,
        filteredByFileSizeCount: filterCounts["file-size"],
    });
    const metadataStartedAt = Date.now();
    const metadataResult = await readMusicMetas(
        metadataCandidates,
        token,
        onProgress,
    );
    const metadataMs = Date.now() - metadataStartedAt;
    const metas = metadataResult.metadata;
    if (token !== importToken) {
        throw new Error("Import Broken");
    }
    const scannedItems = metadataCandidates
        .map((candidate, index) => {
            const musicPath = candidate.musicPath;
            const displayName =
                candidate.displayName ??
                getFileName(musicPath, true);
            return {
                candidate,
                musicPath,
                displayName,
                size: candidate.size,
                meta: metas[index],
            };
        })
        .filter(item => {
            const reason = getLocalMusicScanFilterReason(
                item,
                item.meta,
                scanPolicy,
            );
            countFilterReason(reason);
            if (reason) {
                filteredItems.push({
                    candidate: item.candidate,
                    reason,
                });
            }
            return !reason;
        });
    const metadataIssuePaths = new Set(
        metadataResult.issues.map(issue => issue.candidate.musicPath),
    );
    const musicItems: IMusic.IMusicItem[] = scannedItems.map(
        ({ musicPath, displayName, size, meta }) => {
            const fields = resolveLocalMusicImportFields({
                filename: displayName,
                embeddedMetadata: meta,
                fallbackTitle: getFileName(displayName),
                fallbackArtist: "未知歌手",
            });
            const durationMilliseconds =
                normalizeLocalMusicDurationMilliseconds(meta?.duration);
            const album = meta?.album ?? "未知专辑";
            const localFileIdentity = createLocalMusicFileIdentity({
                displayName,
                size,
                durationMilliseconds,
                title: fields.title,
                artist: fields.artist,
                album,
            });
            return {
                id:
                    fields.id ??
                    CryptoJs.MD5(musicPath).toString(CryptoJs.enc.Hex),
                platform: fields.platform ?? localPluginPlatform,
                title: fields.title,
                artist: fields.artist,
                duration: durationMilliseconds / 1000,
                album,
                artwork: "",
                [internalSerializeKey]: {
                    localPath: musicPath,
                    ...(metadataIssuePaths.has(musicPath)
                        ? {
                            [localMetadataFallbackKey]: {
                                title: fields.title,
                                artist: fields.artist,
                                duration: durationMilliseconds / 1000,
                                album,
                            },
                        }
                        : {}),
                    ...(localFileIdentity
                        ? { [localFileIdentityKey]: localFileIdentity }
                        : {}),
                },
            } as IMusic.IMusicItem;
        },
    );
    if (token !== importToken) {
        throw new Error("Import Broken");
    }
    onProgress?.({
        stage: "merging",
        completed: 0,
        total: musicItems.length,
        cachedMetadataCount: metadataResult.cachedCount,
        metadataWarningCount: metadataResult.issues.length,
    });
    const mergeStartedAt = Date.now();
    const mergeReport = await mergeImportedMusicItems(musicItems, token);
    const mergeMs = Date.now() - mergeStartedAt;
    onProgress?.({
        stage: "merging",
        completed: musicItems.length,
        total: musicItems.length,
        cachedMetadataCount: metadataResult.cachedCount,
        metadataWarningCount: metadataResult.issues.length,
    });
    if (token === importToken) {
        importToken = null;
    }
    const filteredCount =
        filterCounts["file-size"] +
        filterCounts.duration +
        filterCounts["likely-system-sound"];
    const totalMs = Date.now() - startedAt;
    trace("本地音乐扫描导入完成", {
        candidateCount: candidates.length,
        importedCount: musicItems.length,
        filteredCount,
        filteredByFileSizeCount: filterCounts["file-size"],
        filteredByDurationCount: filterCounts.duration,
        filteredLikelySystemSoundCount:
            filterCounts["likely-system-sound"],
        addedCount: mergeReport.addedCount,
        exactMatchedCount: mergeReport.exactMatchedCount,
        weakMatchedCount: mergeReport.weakMatchedCount,
        metadataEnrichedCount: mergeReport.metadataEnrichedCount,
        cachedMetadataCount: metadataResult.cachedCount,
        metadataReadCount: metadataResult.readCount,
        metadataWarningCount: metadataResult.issues.length,
        timings: {
            discoveryMs,
            metadataMs,
            mergeMs,
            totalMs,
        },
    });
    const report: ILocalMusicImportReport = {
        scannedCount: candidates.length,
        filteredCount,
        filteredByFileSizeCount: filterCounts["file-size"],
        filteredByDurationCount: filterCounts.duration,
        filteredLikelySystemSoundCount:
            filterCounts["likely-system-sound"],
        addedCount: mergeReport.addedCount,
        exactMatchedCount: mergeReport.exactMatchedCount,
        weakMatchedCount: mergeReport.weakMatchedCount,
        metadataEnrichedCount: mergeReport.metadataEnrichedCount,
        cachedMetadataCount: metadataResult.cachedCount,
        metadataReadCount: metadataResult.readCount,
        metadataWarningCount: metadataResult.issues.length,
        filteredItems,
        metadataIssues: metadataResult.issues,
        timings: {
            discoveryMs,
            metadataMs,
            mergeMs,
            totalMs,
        },
    };
    onProgress?.({
        stage: "complete",
        completed: candidates.length,
        total: candidates.length,
        cachedMetadataCount: metadataResult.cachedCount,
        metadataWarningCount: metadataResult.issues.length,
    });
    return report;
}

async function importLocal(
    _folderPaths: string[],
    scanPolicy?: ILocalMusicScanPolicy,
    onProgress?: LocalMusicScanProgressListener,
) {
    const startedAt = Date.now();
    const folderPaths = [..._folderPaths.map(normalizeFsPath)];
    trace("本地音乐扫描开始", {
        folderCount: folderPaths.length,
    });
    onProgress?.({
        stage: "discovering",
        completed: 0,
        total: folderPaths.length,
        cachedMetadataCount: 0,
        metadataWarningCount: 0,
    });
    const { candidates, token } = await getMusicCandidates(
        folderPaths,
        onProgress,
    );
    try {
        return await importMusicCandidates(
            candidates,
            token,
            scanPolicy,
            onProgress,
            Date.now() - startedAt,
        );
    } finally {
        if (token === importToken) {
            importToken = null;
        }
    }
}

async function importAndroidCandidates(
    sourceLabel: string,
    loadCandidates: () => Promise<ILocalMusicScanCandidate[]>,
    scanPolicy?: ILocalMusicScanPolicy,
    onProgress?: LocalMusicScanProgressListener,
) {
    const startedAt = Date.now();
    const token = nanoid();
    importToken = token;
    trace(`${sourceLabel} 本地音乐扫描开始`);
    onProgress?.({
        stage: "discovering",
        completed: 0,
        total: 0,
        cachedMetadataCount: 0,
        metadataWarningCount: 0,
    });
    try {
        const candidates = await loadCandidates();
        if (token !== importToken) {
            throw new Error("Import Broken");
        }
        trace(`${sourceLabel} 本地音乐查询完成`, {
            count: candidates.length,
        });
        return await importMusicCandidates(
            candidates,
            token,
            scanPolicy,
            onProgress,
            Date.now() - startedAt,
        );
    } finally {
        if (token === importToken) {
            importToken = null;
        }
    }
}

async function importAndroidMediaStore(
    scanPolicy?: ILocalMusicScanPolicy,
    onProgress?: LocalMusicScanProgressListener,
) {
    return importAndroidCandidates("MediaStore", async () => {
        const items: IMediaStoreAudioItem[] =
            await StorageUri.queryAudioMediaStore();
        return items
            .filter(item => item.exists && item.uri.startsWith("content://"))
            .map(item => ({
                musicPath: item.uri,
                displayName: item.displayName,
                size: item.size,
                modifiedAt: item.modifiedAt,
            }));
    }, scanPolicy, onProgress);
}

async function importAndroidDirectory(
    treeUri: string,
    scanPolicy?: ILocalMusicScanPolicy,
    onProgress?: LocalMusicScanProgressListener,
) {
    return importAndroidCandidates("SAF", async () => {
        const items = await StorageUri.listDirectoryDocuments(
            treeUri,
            supportLocalMediaType,
        );
        return items
            .filter(item => item.exists && item.uri.startsWith("content://"))
            .map(item => ({
                musicPath: item.uri,
                displayName: item.displayName,
                size: item.size,
                modifiedAt: item.modifiedAt,
            }));
    }, scanPolicy, onProgress);
}

async function importLocalCandidates(
    candidates: ILocalMusicScanCandidate[],
    scanPolicy?: ILocalMusicScanPolicy,
    onProgress?: LocalMusicScanProgressListener,
) {
    const token = nanoid();
    importToken = token;
    try {
        return await importMusicCandidates(
            candidates,
            token,
            scanPolicy,
            onProgress,
        );
    } finally {
        if (token === importToken) {
            importToken = null;
        }
    }
}

/** 是否为本地音乐 */
function isLocalMusic(
    musicItem: ICommon.IMediaBase | null,
): IMusic.IMusicItem | undefined {
    return findLocalMusicItem(localSheet, musicItem);
}

function useLocalMusic(musicItem: IMusic.IMusicItem | null) {
    const localMusicState = localSheetStateMapper.useMappedState();
    return useMemo(
        () => findLocalMusicItem(localMusicState, musicItem),
        [localMusicState, musicItem],
    );
}

/** 状态-是否为本地音乐 */
function useIsLocal(musicItem: IMusic.IMusicItem | null) {
    return !!useLocalMusic(musicItem);
}

function useLocalFileExists(musicItem: IMusic.IMusicItem | null) {
    const localMusicState = localSheetStateMapper.useMappedState();
    const requestGeneration = useRef(0);
    const fileCheckItem = useMemo(
        () => resolveLocalFileCheckItem(localMusicState, musicItem),
        [localMusicState, musicItem],
    );
    const localPath = fileCheckItem ? getLocalPath(fileCheckItem) : null;
    const fsPath = localPath ? normalizeFsPath(localPath) : null;
    const [fileStatus, setFileStatus] = useState<{
        path: string | null;
        value: boolean | null;
    }>({ path: null, value: null });

    useEffect(() => {
        const generation = ++requestGeneration.current;
        if (!fsPath) {
            setFileStatus({ path: fsPath, value: null });
            return;
        }
        if (fsPath.startsWith("content://")) {
            setFileStatus({ path: fsPath, value: null });
            StorageUri.exists(fsPath)
                .catch(() => false)
                .then(result => {
                    if (
                        requestGeneration.current === generation &&
                        fsPath === normalizeFsPath(localPath ?? "")
                    ) {
                        setFileStatus({ path: fsPath, value: result });
                    }
                });
            return () => {
                requestGeneration.current += 1;
            };
        }

        const cached = localFileExistsResolver.peek(fsPath);
        setFileStatus({ path: fsPath, value: cached ?? null });
        localFileExistsResolver.resolve(fsPath).then(result => {
            if (
                requestGeneration.current === generation &&
                fsPath === normalizeFsPath(localPath ?? "")
            ) {
                setFileStatus({ path: fsPath, value: result });
            }
        });

        return () => {
            requestGeneration.current += 1;
        };
    }, [fsPath, localPath]);

    return fileStatus.path === fsPath ? fileStatus.value : null;
}

function getMusicList() {
    return localSheet;
}

async function updateMusicList(
    newSheet: IMusic.IMusicItem[],
    baselineSheet: readonly IMusic.IMusicItem[] = localSheet,
) {
    const editedSnapshot = [...newSheet];
    const baselineSnapshot = [...baselineSheet];
    await localSheetRepository.mutate(current =>
        mergeEditedListWithConcurrentChanges({
            current,
            edited: editedSnapshot,
            baseline: baselineSnapshot,
            getKey: getMediaUniqueKey,
        }),
    );
}

async function relocateMusic(musicItem: IMusic.IMusicItem, newPath: string) {
    const nextLocalPath = normalizeFsPath(newPath);
    const previousLocalPath = getLocalPath(musicItem);
    if (!isSupportedLocalMediaFile(nextLocalPath)) {
        throw new Error("不支持的音频格式");
    }
    if (!(await exists(nextLocalPath))) {
        throw new Error("文件不存在");
    }

    let updatedMusicItem: IMusic.IMusicItem | undefined;
    await localSheetRepository.mutate(current => {
        const targetIndex = current.findIndex(item =>
            isSameMediaItem(item, musicItem),
        );
        if (targetIndex === -1) {
            throw new Error("未找到本地音乐记录");
        }

        updatedMusicItem = patchLocalPath(current[targetIndex], nextLocalPath);
        const nextSheet = [...current];
        nextSheet[targetIndex] = updatedMusicItem;
        return nextSheet;
    });

    await syncLocalMusicPathReferences(updatedMusicItem!);
    [previousLocalPath, nextLocalPath].forEach(localPath => {
        if (localPath) {
            localFileExistsResolver.invalidate(normalizeFsPath(localPath));
            invalidateLocalMusicArtworkCache(localPath);
        }
    });
    return updatedMusicItem!;
}

async function previewRelocateMusic(
    musicItem: IMusic.IMusicItem,
    newPath: string,
): Promise<ILocalMusicRelocatePreview> {
    const nextLocalPath = normalizeFsPath(newPath);
    if (!isSupportedLocalMediaFile(nextLocalPath)) {
        throw new Error("不支持的音频格式");
    }
    if (!(await exists(nextLocalPath))) {
        throw new Error("文件不存在");
    }

    const selectedMusicItem = await createLocalMusicItemFromPath(nextLocalPath);
    const titleMatched = isComparableTextClose(
        musicItem.title,
        selectedMusicItem.title,
    );
    const artistMatched = isComparableTextClose(
        musicItem.artist,
        selectedMusicItem.artist,
    );

    return {
        currentLabel: formatMusicLabel(musicItem),
        selectedLabel: formatMusicLabel(selectedMusicItem),
        needsConfirmation: titleMatched === false || artistMatched === false,
    };
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
            const localPath = getLocalPath(
                partialMusicItem as IMusic.IMusicItem,
            );
            const fsPath = localPath ? normalizeFsPath(localPath) : null;
            if (!fsPath) {
                report.skippedCount += 1;
                pushLimitedReason(
                    skippedReasons,
                    `${formatMusicLabel(partialMusicItem)}: 缺少本地路径`,
                );
            } else {
                validMusicItems.push({
                    ...partialMusicItem,
                    id:
                        partialMusicItem.id ??
                        CryptoJs.MD5(fsPath).toString(CryptoJs.enc.Hex),
                    platform: partialMusicItem.platform ?? localPluginPlatform,
                    title: partialMusicItem.title ?? getFileName(fsPath),
                    artist: partialMusicItem.artist ?? "未知歌手",
                    duration: partialMusicItem.duration ?? 0,
                    album: partialMusicItem.album ?? "未知专辑",
                    artwork: partialMusicItem.artwork ?? "",
                    [internalSerializeKey]: {
                        ...(partialMusicItem[internalSerializeKey] ?? {}),
                        localPath,
                    },
                } as IMusic.IMusicItem);
                if (!(await exists(fsPath))) {
                    pushLimitedReason(
                        skippedReasons,
                        `${formatMusicLabel(
                            partialMusicItem,
                        )}: 文件不存在，可重新定位`,
                    );
                }
            }
        } catch (e: any) {
            report.skippedCount += 1;
            pushLimitedReason(
                skippedReasons,
                `${formatMusicLabel(
                    musicItem as Partial<IMusic.IMusicItem>,
                )}: ${e?.message ?? String(e)}`,
            );
        }
    }

    if (skippedReasons.length) {
        report.failureReasons.push(...skippedReasons);
        const omittedReasonCount = Math.max(
            0,
            report.skippedCount - skippedReasons.length,
        );
        if (omittedReasonCount > 0) {
            report.failureReasons.push(
                `还有 ${omittedReasonCount} 首本地音乐被跳过`,
            );
        }
    }

    if (validMusicItems.length) {
        try {
            const addedCount = await addMusic(validMusicItems);
            report.successCount = addedCount;
            const duplicateCount = validMusicItems.length - addedCount;
            if (duplicateCount > 0) {
                report.skippedCount += duplicateCount;
                report.failureReasons.push(
                    `${duplicateCount} 首本地音乐已存在，未重复添加`,
                );
            }
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
    upsertMusic,
    removeMusic,
    removeMusicIfLocalPath,
    addMusicDraft,
    saveLocalSheet,
    importLocal,
    importAndroidMediaStore,
    importAndroidDirectory,
    importLocalCandidates,
    cancelImportLocal,
    isLocalMusic,
    isSupportedLocalMediaFile,
    isHiddenMusic,
    getLocalMusicFolder,
    useLocalMusic,
    useIsLocal,
    useIsHidden,
    useHiddenState,
    getMusicList,
    useMusicList: localSheetStateMapper.useMappedState,
    useLocalFileExists,
    updateMusicList,
    hideMusic,
    unhideMusic,
    hideFolder,
    unhideFolder,
    previewRelocateMusic,
    relocateMusic,
    resumeMusicList,
};

export default LocalMusicSheet;

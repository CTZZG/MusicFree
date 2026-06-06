import {
    StorageKeys,
    internalSerializeKey,
    supportLocalMediaType,
} from "@/constants/commonConst";
import mp3Util, { IBasicMeta } from "@/native/mp3Util";
import { getFileName, removeFileScheme } from "@/utils/fileUtils.ts";
import {
    getLocalPath,
    isSameMediaItem,
} from "@/utils/mediaUtils";
import { trace } from "@/utils/log";
import StateMapper from "@/utils/stateMapper";
import { getStorage, setStorage } from "@/utils/storage";
import CryptoJs from "crypto-js";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { ReadDirItem, exists, readDir, unlink } from "react-native-fs";

let localSheet: IMusic.IMusicItem[] = [];
const localSheetStateMapper = new StateMapper(() => localSheet);

export async function setup() {
    const sheet = await getStorage(StorageKeys.LocalMusicSheet);
    if (sheet) {
        let validSheet: IMusic.IMusicItem[] = [];
        for (let musicItem of sheet) {
            const localPath = getLocalPath(musicItem);
            const fsPath = localPath ? normalizeFsPath(localPath) : null;
            if (fsPath && (await exists(fsPath))) {
                validSheet.push(musicItem);
            }
        }
        if (validSheet.length !== sheet.length) {
            await setStorage(StorageKeys.LocalMusicSheet, validSheet);
        }
        localSheet = validSheet;
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
        if (localSheet.findIndex(_ => isSameMediaItem(mi, _)) === -1) {
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
        if (localSheet.findIndex(_ => isSameMediaItem(mi, _)) === -1) {
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
    const data = fn.slice(0, fn.lastIndexOf(".")).split("@");
    const [platform, id, title, artist] = data;
    if (!platform || !id) {
        return null;
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

function normalizeFsPath(filePath: string) {
    const rawPath = removeFileScheme(filePath);
    try {
        return decodeURI(rawPath);
    } catch {
        return rawPath;
    }
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

async function importLocal(_folderPaths: string[]) {
    const folderPaths = [..._folderPaths.map(normalizeFsPath)];
    trace("本地音乐扫描开始", {
        folderCount: folderPaths.length,
        folders: folderPaths,
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
    await addMusic(musicItems);
    if (token === importToken) {
        importToken = null;
    }
    trace("本地音乐扫描导入完成", { count: musicItems.length });
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

const LocalMusicSheet = {
    setup,
    addMusic,
    removeMusic,
    addMusicDraft,
    saveLocalSheet,
    importLocal,
    cancelImportLocal,
    isLocalMusic,
    useIsLocal,
    getMusicList,
    useMusicList: localSheetStateMapper.useMappedState,
    updateMusicList,
};

export default LocalMusicSheet;

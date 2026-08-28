import getOrCreateMMKV, { hydrateKeyValueStore } from "@/utils/getOrCreateMMKV.ts";
import { InteractionManager } from "react-native";
import { SortType } from "@/constants/commonConst.ts";
import { safeParse, safeStringify } from "@/utils/jsonUtil";

/**
 * 确保某个歌单 store 已从磁盘载入。
 *
 * 键值存储改为文件支撑后，读取不再像 MMKV 那样构造即可用（mmap 是同步的）。
 * 歌单 store 是按 id 动态创建的，不在启动预载列表里，因此**首次**读取前必须
 * 显式 hydrate——否则会读到空表，表现为歌单凭空消失。
 */
export async function ensureSheetStorageReady(key: string) {
    await hydrateKeyValueStore(`LocalSheet.${key}`);
}

function getStorageData(key: string) {
    const mmkv = getOrCreateMMKV(`LocalSheet.${key}`);

    return safeParse(mmkv.getString("data"));
}

async function setStorageData(key: string, value: any) {
    return InteractionManager.runAfterInteractions(() => {
        const mmkv = getOrCreateMMKV(`LocalSheet.${key}`);
        mmkv.set("data", safeStringify(value));
    });
}

function removeStorageData(key: string) {
    const mmkv = getOrCreateMMKV(`LocalSheet.${key}`);
    mmkv.clearAll();
}

/**
 * 存储歌单的基本信息
 * @param sheets 歌单数据
 */
async function setSheets(sheets: IMusic.IMusicSheetItemBase[]) {
    return await setStorageData("music-sheets", sheets);
}

/**
 * 获取歌单的基本信息
 */
function getSheets(): IMusic.IMusicSheetItemBase[] {
    return getStorageData("music-sheets");
}

/**
 * 存储歌单的基本信息
 * @param sheets 歌单数据
 */
async function setStarredSheets(sheets: IMusic.IMusicSheetItemBase[]) {
    return await setStorageData("starred-sheets", sheets);
}

/**
 * 获取歌单的基本信息
 */
function getStarredSheets(): IMusic.IMusicSheetItem[] {
    return getStorageData("starred-sheets");
}

/**
 * 存储歌单内的歌曲
 * @param sheetId 歌单id
 * @param musicList 歌曲列表
 */
async function setMusicList(sheetId: string, musicList: IMusic.IMusicItem[]) {
    return await setStorageData(sheetId, musicList);
}

/**
 * 获取歌单内的歌曲
 * @param sheetId 歌单id
 * @returns 歌曲列表
 */
function getMusicList(sheetId: string): IMusic.IMusicItem[] {
    return getStorageData(sheetId);
}

/**
 * 清空歌单内的歌曲/其他信息
 * @param sheetId
 */
function removeMusicList(sheetId: string) {
    return removeStorageData(sheetId);
}

interface IMusicSheetMeta extends Record<string, string> {
    sort: SortType;
}

function setSheetMeta<K extends keyof IMusicSheetMeta>(
    sheetId: string,
    key: K,
    value: IMusicSheetMeta[K],
) {
    const mmkv = getOrCreateMMKV(`LocalSheet.${sheetId}`);
    mmkv.set("meta." + key, value);
}

function getSheetMeta<K extends keyof IMusicSheetMeta>(
    sheetId: string,
    key: K,
): IMusicSheetMeta[K] | null {
    const mmkv = getOrCreateMMKV(`LocalSheet.${sheetId}`);
    return mmkv.getString("meta." + key) || null;
}

/**
 * 载入歌单索引所需的两个固定 store。必须在 getSheets/getStarredSheets 之前
 * 调用——它们是同步读，而文件存储需要先异步读盘。
 */
async function hydrateSheetIndex() {
    await Promise.all([
        ensureSheetStorageReady("music-sheets"),
        ensureSheetStorageReady("starred-sheets"),
    ]);
}

/** 载入某个歌单自己的曲目列表与元数据 store。 */
async function hydrateSheet(sheetId: string) {
    await ensureSheetStorageReady(sheetId);
}

const storage = {
    hydrateSheetIndex,
    hydrateSheet,
    setSheets,
    getSheets,
    setMusicList,
    getMusicList,
    removeMusicList,
    setSheetMeta,
    getSheetMeta,
    setStarredSheets,
    getStarredSheets,
};

export default storage;

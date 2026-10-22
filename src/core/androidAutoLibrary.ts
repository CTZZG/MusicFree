import { AUTO_LIBRARY_PREFIX } from "@/core/playerAdapter/autoLibraryMediaId";
import type { PlayerAdapterBrowseItem } from "@/core/playerAdapter/types";
import { getMediaUniqueKey } from "@/utils/mediaIdentity";

/**
 * Android Auto 里的“我喜欢”“最近播放”（原生侧见 MpvMediaBrowserService）。
 *
 * 车机打开列表时原生来要内容，这里现读现给，不另外维护一份同步的副本；点了其中一首，
 * 媒体 ID 带着 library/ 前缀回来，用整个列表替换播放队列，从这首开始播。
 */
/** 车机上一个列表最多显示多少首；替换播放队列时用的仍是整个列表 */
export const AUTO_LIBRARY_LIST_LIMIT = 200;

export type AutoLibraryListId = "favorite" | "recent";

/** id 是 library/<列表>/<歌曲的唯一键，URI 编码> */
export type IAutoLibraryItem = PlayerAdapterBrowseItem;

export type IAutoLibrarySources = Record<AutoLibraryListId, () => IMusic.IMusicItem[]>;

export interface IAutoLibraryDependencies {
    sources: IAutoLibrarySources;
    /** 把列表内容交给原生，答复车机 */
    provide(parentId: string, items: IAutoLibraryItem[]): Promise<void>;
    /** 用整个列表替换播放队列，从这首开始播 */
    play(musicItem: IMusic.IMusicItem, list: IMusic.IMusicItem[]): Promise<void>;
}

const LIST_IDS: AutoLibraryListId[] = ["favorite", "recent"];

function isListId(value: string): value is AutoLibraryListId {
    return (LIST_IDS as string[]).includes(value);
}

export function encodeAutoLibraryItemId(listId: AutoLibraryListId, musicItem: IMusic.IMusicItem) {
    return `${AUTO_LIBRARY_PREFIX}${listId}/${encodeURIComponent(getMediaUniqueKey(musicItem))}`;
}

/** 列表本身（library/favorite）没有 key；不是 library/ 开头或列表不认识时返回 null */
export function parseAutoLibraryMediaId(
    mediaId: string,
): { listId: AutoLibraryListId; key?: string } | null {
    if (!mediaId.startsWith(AUTO_LIBRARY_PREFIX)) {
        return null;
    }
    const rest = mediaId.slice(AUTO_LIBRARY_PREFIX.length);
    const slash = rest.indexOf("/");
    const listId = slash < 0 ? rest : rest.slice(0, slash);
    if (!isListId(listId)) {
        return null;
    }
    if (slash < 0) {
        return { listId };
    }
    try {
        const key = decodeURIComponent(rest.slice(slash + 1));
        return key ? { listId, key } : null;
    } catch {
        return null;
    }
}

export function toAutoLibraryItems(
    listId: AutoLibraryListId,
    musicList: IMusic.IMusicItem[],
): IAutoLibraryItem[] {
    return musicList.slice(0, AUTO_LIBRARY_LIST_LIMIT).map(musicItem => ({
        id: encodeAutoLibraryItemId(listId, musicItem),
        title: musicItem.title || "",
        artist: musicItem.artist || "",
        album: musicItem.album || "",
        artwork: typeof musicItem.artwork === "string" ? musicItem.artwork : null,
    }));
}

export function createAutoLibrary(dependencies: IAutoLibraryDependencies) {
    const readList = (listId: AutoLibraryListId) => {
        try {
            return dependencies.sources[listId]() ?? [];
        } catch {
            return [];
        }
    };

    return {
        /** 原生来要列表内容；不认识的列表也答复（空的），车机不用干等到超时 */
        async handleBrowseRequest(parentId: string) {
            const parsed = parseAutoLibraryMediaId(parentId);
            const items =
                parsed && !parsed.key
                    ? toAutoLibraryItems(parsed.listId, readList(parsed.listId))
                    : [];
            await dependencies.provide(parentId, items);
        },

        /**
         * 车机上点了列表里的一首。返回 false 表示这个媒体 ID 不归这里管；
         * 歌已经不在列表里（刚取消收藏）时什么也不播。
         */
        async handlePlay(mediaId: string): Promise<boolean> {
            const parsed = parseAutoLibraryMediaId(mediaId);
            if (!parsed?.key) {
                return false;
            }
            const list = readList(parsed.listId);
            const musicItem = list.find(item => getMediaUniqueKey(item) === parsed.key);
            if (musicItem) {
                await dependencies.play(musicItem, list);
            }
            return true;
        },
    };
}

import delay from "@/utils/delay";
import { parseArtists } from "@/utils/artistParser";
import { getMediaUniqueKey } from "@/utils/mediaIdentity";
import PersistStatus from "@/utils/persistStatus";
import { matchRecording } from "@/utils/sameRecording";

/**
 * 一首歌的来源播放失败时，到其他来源找同一个录音（规则见 sameRecording.ts），
 * 并记住能播的那个：下次这首歌的原来源再失败，先试记住的来源，不用再搜一遍。
 *
 * 原来源每次都先试：它恢复了就照常用它，记住的来源只是失败时的后备。
 */

export interface AlternateSearchSource {
    name: string;
    search: (keyword: string) => Promise<IMusic.IMusicItem[] | null | undefined>;
}

/** 每个来源只看第一页的前几条：同一首歌排在后面多半是别的版本 */
const CANDIDATES_PER_SOURCE = 5;
const MAX_REMEMBERED = 300;

interface RememberedAlternate {
    item: IMusic.IMusicItem;
    savedAt: number;
}

export function alternateSearchKeyword(musicItem: IMusic.IMusicItem) {
    const title = typeof musicItem.title === "string" ? musicItem.title.trim() : "";
    const [firstArtist] = parseArtists(musicItem.artist);
    return title ? [title, firstArtist].filter(Boolean).join(" ") : "";
}

/**
 * 各来源同时搜，最多等 timeoutMs（后台也计时）。返回所有是同一录音的候选：
 * 先按接近程度（专辑一致、时长差小），再按来源顺序和来源里的排名。
 */
export async function findAlternateCandidates(
    original: IMusic.IMusicItem,
    sources: AlternateSearchSource[],
    options: { timeoutMs: number; isCancelled?: () => boolean },
): Promise<IMusic.IMusicItem[]> {
    const keyword = alternateSearchKeyword(original);
    const others = sources.filter(source => source.name !== original.platform);
    if (!keyword || others.length === 0) {
        return [];
    }
    const timeout = Promise.resolve(delay(options.timeoutMs)).then(() => null);
    const perSource = await Promise.all(others.map(async (source, sourceIndex) => {
        const items = await Promise.race([
            source.search(keyword).catch(() => null),
            timeout,
        ]);
        if (!Array.isArray(items)) {
            return [];
        }
        return items.slice(0, CANDIDATES_PER_SOURCE).flatMap((item, rank) => {
            const score = matchRecording(original, item);
            return score === null || item?.id == null
                ? []
                : [{ item: { ...item, platform: item.platform || source.name }, score, sourceIndex, rank }];
        });
    }));
    if (options.isCancelled?.()) {
        return [];
    }
    return perSource
        .flat()
        .sort((left, right) =>
            left.score - right.score ||
            left.sourceIndex - right.sourceIndex ||
            left.rank - right.rank)
        .map(candidate => candidate.item);
}

function readRemembered(): Record<string, RememberedAlternate> {
    const value = PersistStatus.get("music.alternateSources");
    return value && typeof value === "object" ? value : {};
}

/** 记住的来源仍要满足同一录音的规则：原来的歌信息变了，记录就作废 */
export function getRememberedAlternate(original: IMusic.IMusicItem) {
    const entry = readRemembered()[getMediaUniqueKey(original)];
    const item = entry?.item;
    if (!item || item.id == null || !item.platform || item.platform === original.platform) {
        return null;
    }
    return matchRecording(original, item) === null ? null : item;
}

export function rememberAlternate(
    original: IMusic.IMusicItem,
    alternate: IMusic.IMusicItem,
    now = Date.now(),
) {
    const entries = { ...readRemembered() };
    entries[getMediaUniqueKey(original)] = { item: alternate, savedAt: now };
    const keys = Object.keys(entries);
    if (keys.length > MAX_REMEMBERED) {
        keys
            .sort((left, right) => (entries[left]?.savedAt ?? 0) - (entries[right]?.savedAt ?? 0))
            .slice(0, keys.length - MAX_REMEMBERED)
            .forEach(key => {
                delete entries[key];
            });
    }
    PersistStatus.set("music.alternateSources", entries);
}

export function forgetAlternate(original: IMusic.IMusicItem) {
    const entries = readRemembered();
    const key = getMediaUniqueKey(original);
    if (entries[key]) {
        const next = { ...entries };
        delete next[key];
        PersistStatus.set("music.alternateSources", next);
    }
}

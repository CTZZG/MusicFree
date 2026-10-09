/**
 * 从旧 MMKV 补迁移时，新存储里已经有同一个键的合并规则（纯函数）。
 *
 * 0.8.0 起键值存储换成了文件，但歌单（LocalSheet.*）和各插件的附加信息
 * （MediaExtra.*）这些按需创建的 store 一直没有从旧 MMKV 迁移。升级后的用户
 * 看不到原来的歌单，应用随后又建了默认歌单“我喜欢”，之后加的歌、下载标记也
 * 都写进了新存储。所以补迁移时同一个键两边都可能有数据：不能用旧的覆盖新的，
 * 也不能因为新的已存在就丢掉旧的。
 *
 * 每个函数收到旧值和新值（都是存储里的字符串），返回合并后的字符串；返回
 * undefined 表示保留新值不动（解析失败、形状不对时也这样）。
 */

export type LegacyMerge = (
    key: string,
    legacy: string,
    current: string,
) => string | undefined;

function parseArray(raw: string): unknown[] | null {
    try {
        const value = JSON.parse(raw);
        return Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

function parseObject(raw: string): Record<string, unknown> | null {
    try {
        const value = JSON.parse(raw);
        return value && typeof value === "object" && !Array.isArray(value)
            ? value
            : null;
    } catch {
        return null;
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * 歌单索引：按 identity 取并集。顺序以旧的为准（用户原来排好的），同一个
 * 歌单字段以新的为准（升级后可能改过名、换过封面），只在新存储里的排在后面。
 */
function mergeIndex(
    legacyRaw: string,
    currentRaw: string,
    identity: (item: Record<string, unknown>) => string | null,
): string | undefined {
    const legacy = parseArray(legacyRaw);
    const current = parseArray(currentRaw);
    if (!legacy || !current) {
        return undefined;
    }
    const currentById = new Map<string, Record<string, unknown>>();
    for (const item of current) {
        const id = isObject(item) ? identity(item) : null;
        if (id !== null) {
            currentById.set(id, item as Record<string, unknown>);
        }
    }
    const merged: unknown[] = [];
    const seen = new Set<string>();
    for (const item of legacy) {
        const id = isObject(item) ? identity(item) : null;
        if (id === null || seen.has(id)) {
            continue;
        }
        seen.add(id);
        merged.push({ ...(item as object), ...(currentById.get(id) ?? {}) });
    }
    for (const item of current) {
        const id = isObject(item) ? identity(item) : null;
        if (id === null || seen.has(id)) {
            continue;
        }
        seen.add(id);
        merged.push(item);
    }
    return JSON.stringify(merged);
}

/** 本地歌单索引（LocalSheet.music-sheets 的 data）：按 id。 */
export function mergeSheetIndex(legacy: string, current: string) {
    return mergeIndex(legacy, current, item =>
        item.id === undefined || item.id === null ? null : `${item.id}`,
    );
}

/** 收藏的歌单（LocalSheet.starred-sheets 的 data）：来自不同插件，按 平台+id。 */
export function mergeStarredSheetIndex(legacy: string, current: string) {
    return mergeIndex(legacy, current, item =>
        item.id === undefined || item.id === null
            ? null
            : `${item.platform ?? ""}@${item.id}`,
    );
}

/**
 * 歌单里的歌（LocalSheet.<id> 的 data）：升级后加的在前（更新），旧的里
 * 新列表没有的接在后面。同一首歌（平台+id）只留新的那条。
 */
export function mergeMusicList(legacy: string, current: string) {
    const legacyList = parseArray(legacy);
    const currentList = parseArray(current);
    if (!legacyList || !currentList) {
        return undefined;
    }
    const key = (item: unknown) =>
        isObject(item) && item.id !== undefined && item.platform !== undefined
            ? `${item.platform}@${item.id}`
            : null;
    const seen = new Set<string>();
    const merged: unknown[] = [];
    for (const item of [...currentList, ...legacyList]) {
        const id = key(item);
        if (id === null || seen.has(id)) {
            continue;
        }
        seen.add(id);
        merged.push(item);
    }
    return JSON.stringify(merged);
}

/** 一首歌的附加信息（MediaExtra.<平台> 的每个键）：逐字段合并，新的优先。 */
export function mergeMediaExtra(legacy: string, current: string) {
    const legacyObject = parseObject(legacy);
    const currentObject = parseObject(current);
    if (!legacyObject || !currentObject) {
        return undefined;
    }
    return JSON.stringify({ ...legacyObject, ...currentObject });
}

/** 某个歌单 store 里各个键的合并规则。 */
export function sheetStoreMerge(storeKey: string): LegacyMerge {
    return (key, legacy, current) => {
        if (key !== "data") {
            // meta.sort 这类设置：升级后改过的为准
            return undefined;
        }
        if (storeKey === "music-sheets") {
            return mergeSheetIndex(legacy, current);
        }
        if (storeKey === "starred-sheets") {
            return mergeStarredSheetIndex(legacy, current);
        }
        return mergeMusicList(legacy, current);
    };
}

/** 插件附加信息 store：每个键是一首歌。 */
export const mediaExtraStoreMerge: LegacyMerge = (_key, legacy, current) =>
    mergeMediaExtra(legacy, current);

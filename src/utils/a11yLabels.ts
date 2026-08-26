export interface IA11yMusicItemLike {
    title?: string | null;
    artist?: string | null;
}

/**
 * 把曲目标题/歌手拼成一句朗读文本，供屏幕阅读器使用。
 * 标题缺失时用调用方传入的“未知标题”兜底；歌手缺失时直接省略，不读多余的分隔符。
 */
export function getMusicItemAccessibilityLabel(
    item: IA11yMusicItemLike | null | undefined,
    unknownTitle: string,
): string {
    const title = item?.title?.trim() || unknownTitle;
    const artist = item?.artist?.trim();
    return artist ? `${title}, ${artist}` : title;
}

/**
 * 在基础朗读文本后追加状态后缀（选中/缺失文件等），跳过空值。
 */
export function withAccessibilitySuffixes(
    label: string,
    suffixes: ReadonlyArray<string | null | undefined | false>,
): string {
    const parts = suffixes.filter((part): part is string => !!part);
    return parts.length ? `${label}, ${parts.join(", ")}` : label;
}

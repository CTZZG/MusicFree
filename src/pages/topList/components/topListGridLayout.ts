export type TopListGridOrientation = "vertical" | "horizontal";

interface ITopListGridLayoutOptions {
    containerWidth: number;
    orientation: TopListGridOrientation;
    horizontalPadding: number;
    columnGap: number;
    minCardWidth: number;
}

export function resolveTopListGridLayout(options: ITopListGridLayoutOptions) {
    const {
        containerWidth,
        orientation,
        horizontalPadding,
        columnGap,
        minCardWidth,
    } = options;
    const minColumns = 3;
    const maxColumns = orientation === "horizontal" ? 5 : 4;
    const availableWidth = Math.max(0, containerWidth - horizontalPadding * 2);
    const estimatedColumns = Math.floor(
        (availableWidth + columnGap) / (minCardWidth + columnGap),
    );
    const columnCount = Math.max(
        minColumns,
        Math.min(maxColumns, estimatedColumns || minColumns),
    );
    const itemWidth =
        (availableWidth - columnGap * Math.max(columnCount - 1, 0)) /
        columnCount;

    return {
        availableWidth,
        columnCount,
        // onLayout 返回按像素取整的宽度，可能略大于 Yoga 内部可用宽度。
        // 向下取整留出不足 1 dp 的余量，避免最后一张被挤到下一行。
        itemWidth: Math.max(0, Math.floor(itemWidth)),
    };
}

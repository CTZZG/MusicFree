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
    const minColumns = orientation === "horizontal" ? 3 : 2;
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
        itemWidth: Math.max(0, itemWidth),
    };
}

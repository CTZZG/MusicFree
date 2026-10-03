/** 行在分组卡片里的位置：首行圆上角，末行圆下角，中间的行是直角并带分隔线 */
export type CardGroupPosition = "single" | "first" | "middle" | "last";

export function getCardGroupPosition(
    index: number,
    count: number,
): CardGroupPosition {
    if (count <= 1) {
        return "single";
    }
    if (index === 0) {
        return "first";
    }
    return index === count - 1 ? "last" : "middle";
}

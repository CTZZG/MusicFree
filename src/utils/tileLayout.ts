/**
 * 封面网格和横排的尺寸，按可用宽度算，不写死 dp。
 *
 * 同一台手机把「显示大小」调大后，可用宽度会从 400 多 dp 变成 360 dp 左右。
 * 写死的 156 dp 封面这时要占掉四成多屏宽，一屏只放得下两个，显得臃肿。参照
 * 同类应用（DS ONE）在同一台手机上的实测：网格三列、每格约 105 dp；横排露出
 * 两个半，每个约 130 dp；页边距 12～16 dp，格间距 12 dp。
 */

/** 页面左右边距 */
export const PAGE_MARGIN = 16;
/** 相邻两格之间的距离 */
export const TILE_GAP = 12;

interface ITileGridOptions {
    /** 每格最窄多少，决定一行放几列 */
    minTileWidth: number;
    minColumns?: number;
    margin?: number;
    gap?: number;
}

/** 铺满一行的网格：放得下几列放几列，格宽平分剩下的宽度 */
export function getTileGrid(width: number, options: ITileGridOptions) {
    const {
        minTileWidth,
        minColumns = 2,
        margin = PAGE_MARGIN,
        gap = TILE_GAP,
    } = options;
    const available = Math.max(0, width - margin * 2);
    const columns = Math.max(
        minColumns,
        Math.floor((available + gap) / (minTileWidth + gap)),
    );
    const tileWidth = Math.floor((available - gap * (columns - 1)) / columns);
    return { columns, tileWidth };
}

interface IShelfOptions {
    /** 一屏露出几个，带小数：最后一个只露出一部分，提示还能往后滑 */
    visible: number;
    min: number;
    max: number;
    margin?: number;
    gap?: number;
}

/** 横向滑动的一排封面，每个多宽 */
export function getShelfTileWidth(width: number, options: IShelfOptions) {
    const {
        visible,
        min,
        max,
        margin = PAGE_MARGIN,
        gap = TILE_GAP,
    } = options;
    const gaps = Math.floor(visible);
    const raw = (width - margin - gap * gaps) / visible;
    return Math.round(Math.min(max, Math.max(min, raw)));
}

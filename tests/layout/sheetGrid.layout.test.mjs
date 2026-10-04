// 推荐歌单网格：每一格的封面和标题都要完整落在自己那一列里。
// 以前格子里放的是固定宽度的图片按钮，三列时比列还宽：标题第一个字被裁掉一半，
// 卡片底色从封面上方露出来。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    clippingAncestor,
    createModuleLoader,
    describeFrame,
    findAll,
    isText,
    renderLayout,
    strictStub,
} from './harness.mjs';
import {createCommonStubs, createEnv} from './stubs.mjs';

const h = React.createElement;
const PAGE_MARGIN = 16;
const TILE_GAP = 12;

const SHEETS = [
    {id: '1', title: '华语经典：那些年我们一起听过的歌', artwork: 'a'},
    {id: '2', title: 'Late Night Lo-Fi Beats to Study and Relax', artwork: 'b'},
    {id: '3', title: '纯音乐', artwork: 'c'},
    {id: '4', title: '粤语金曲 · 八九十年代', artwork: 'd'},
    {id: '5', title: '', artwork: 'e'},
    {id: '6', title: 'K-POP 2026 年度榜单 TOP 100 完整版', artwork: 'f'},
    {id: '7', title: '跑步', artwork: 'g'},
    {id: '8', title: 'Классическая музыка для концентрации', artwork: 'h'},
].map(sheet => ({...sheet, platform: '测试源'}));

/**
 * FlashList 2 的网格（GridLayoutManager）：可用宽度是列表内容区去掉左右内边距，
 * 每格宽 = 可用宽度 / 列数，按行排，同一行的格子一样高（取最高的一格）。
 */
function FlashList({
    data,
    renderItem,
    numColumns = 1,
    contentContainerStyle,
    ListFooterComponent,
}) {
    const rows = [];
    for (let start = 0; start < data.length; start += numColumns) {
        rows.push(data.slice(start, start + numColumns));
    }
    return h(
        'ScrollView',
        {contentContainerStyle},
        rows.map((row, rowIndex) =>
            h(
                'View',
                {key: rowIndex, style: {flexDirection: 'row'}},
                row.map((item, column) =>
                    h(
                        'View',
                        {key: column, style: {width: `${100 / numColumns}%`}},
                        renderItem({item, index: rowIndex * numColumns + column}),
                    ),
                ),
            ),
        ),
        ListFooterComponent,
    );
}

function renderSheetGrid(env) {
    const stubs = {
        ...createCommonStubs(env),
        '@shopify/flash-list': strictStub('@shopify/flash-list', {FlashList}),
        '@/pages/recommendSheets/hooks/useRecommendSheets': strictStub(
            'useRecommendSheets',
            {default: () => [() => {}, SHEETS, 'idle']},
        ),
        '@/components/base/listEmpty': strictStub('listEmpty', {
            default: () => null,
        }),
        '@/components/base/listFooter': strictStub('listFooter', {
            default: () => h('View', {style: {height: 48}}),
        }),
        '@/components/musicBar/useMusicBarFloatingOffset': strictStub(
            'useMusicBarFloatingOffset',
            {default: () => 96},
        ),
    };
    const loader = createModuleLoader(stubs);
    const SheetList = loader.load(
        '@/pages/recommendSheets/components/body/sheetList',
    ).default;
    const {width, height} = env.window;
    return renderLayout(h(SheetList, {tag: {id: 'all'}, pluginHash: 'p'}), {
        env,
        width,
        height,
    });
}

function tilesOf(root) {
    // 每一格：一张封面图，下面一行标题
    const covers = findAll(root, record => record.type === 'Image');
    return covers.map(cover => {
        const tile = cover.parent;
        const title = findAll(tile, isText);
        assert.equal(title.length, 1, `tile at ${describeFrame(tile.frame)} has one title`);
        return {tile, cover, title: title[0]};
    });
}

const DEVICES = [
    {name: '320 dp phone', width: 320, height: 640, scale: 2, columns: 3},
    {name: "the user's phone (363 dp)", width: 363, height: 806, scale: 3.5, columns: 3},
    {name: '412 dp phone', width: 412, height: 915, scale: 2.625, columns: 3},
    {name: 'landscape 800 dp', width: 800, height: 363, scale: 3.5, columns: 4},
];

for (const device of DEVICES) {
    for (const fontScale of [1, 1.3, 2]) {
        test(`sheet grid on ${device.name}, font scale ${fontScale}`, () => {
            const env = createEnv({...device, fontScale});
            const {root, unmount} = renderSheetGrid(env);
            try {
                const tiles = tilesOf(root);
                assert.equal(tiles.length, SHEETS.length);

                const rows = new Map();
                for (const {cover, title} of tiles) {
                    // 封面铺满列宽，是正方形
                    assert.ok(
                        Math.abs(cover.frame.width - cover.frame.height) <= 0.5,
                        `cover is square: ${describeFrame(cover.frame)}`,
                    );
                    // 标题在封面正下方，左右不超出封面
                    assert.ok(
                        title.frame.x >= cover.frame.x - 0.5 &&
                            title.frame.x + title.frame.width <=
                                cover.frame.x + cover.frame.width + 0.5,
                        `"${title.text}" ${describeFrame(title.frame)} stays within cover ${describeFrame(cover.frame)}`,
                    );
                    assert.ok(title.frame.y >= cover.frame.y + cover.frame.height);
                    assert.ok(title.textInfo.shownLines <= 2);
                    assert.equal(
                        clippingAncestor(title),
                        null,
                        `"${title.text}" is not clipped`,
                    );
                    assert.equal(clippingAncestor(cover), null, 'cover is not clipped');
                    const key = Math.round(cover.frame.y);
                    rows.set(key, [...(rows.get(key) ?? []), {cover, title}]);
                }

                const rowList = [...rows.values()];
                for (const row of rowList) {
                    const sorted = row.sort((a, b) => a.cover.frame.x - b.cover.frame.x);
                    if (sorted.length === device.columns) {
                        // 整行：两边各留页边距，封面之间是统一的间距
                        const first = sorted[0].cover.frame;
                        const last = sorted[sorted.length - 1].cover.frame;
                        assert.ok(Math.abs(first.x - PAGE_MARGIN) <= 0.5, `left margin ${first.x}`);
                        assert.ok(
                            Math.abs(device.width - (last.x + last.width) - PAGE_MARGIN) <= 0.5,
                            `right margin ${device.width - (last.x + last.width)}`,
                        );
                    }
                    for (let i = 1; i < sorted.length; i += 1) {
                        const previous = sorted[i - 1].cover.frame;
                        const gap = sorted[i].cover.frame.x - (previous.x + previous.width);
                        assert.ok(Math.abs(gap - TILE_GAP) <= 0.5, `gap ${gap}`);
                    }
                }
                // 上一行的标题不压到下一行的封面
                for (let i = 1; i < rowList.length; i += 1) {
                    const titlesBottom = Math.max(
                        ...rowList[i - 1].map(({title}) => title.frame.y + title.frame.height),
                    );
                    const coversTop = Math.min(...rowList[i].map(({cover}) => cover.frame.y));
                    assert.ok(titlesBottom <= coversTop, `row ${i} starts below the titles above`);
                }
            } finally {
                unmount();
            }
        });
    }
}

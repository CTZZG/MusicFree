// 榜单页：标题栏、音源标签、各分组的榜单卡片（方卡、带歌曲预览的横卡）、加载中、
// 出错和没有插件时的空页面。按 1、1.3、1.5、2 倍系统字体排版：文字不被裁掉、不挤成
// 一条缝，卡片不互相压住，方卡上的标题条不把封面整个盖住。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    assertReadable,
    byText,
    clippingAncestor,
    contains,
    createModuleLoader,
    describeFrame,
    findAll,
    findOne,
    isText,
    renderLayout,
    strictStub,
} from './harness.mjs';
import {
    assertSourceTabs,
    createCommonStubs,
    createEnv,
    createPageStubs,
    createTabViewStub,
    inAppFontScaleScope,
    pageMusicBarLayout,
} from './stubs.mjs';

const h = React.createElement;
const PAGE_MARGIN = 16;
const FONT_SCALES = [1, 1.3, 1.5, 2];
const LANGUAGES = ['zh-CN', 'en-US'];

const chart = (id, title, extra = {}) => ({id, title, platform: 'source', ...extra});
const preview = [
    {title: 'Whatever Happens in a Very Long Song Title', artist: 'Michael Jackson'},
    {title: '一首名字很长很长的中文歌曲', artist: '歌手'},
    {title: 'Ready for War', artist: 'Artist'},
];
const SECTIONS = [
    {title: '热门榜单', data: [chart('hot', '热歌榜', {coverImg: 'hot', musicList: preview})]},
    {title: '资料库榜', data: [
        chart('one', '最新入库', {coverImg: 'one'}),
        chart('two', 'Long Chart Name with Many Words', {artwork: 'two'}),
        chart('three', '年代新歌'),
        chart('four', '华语经典怀旧金曲精选榜'),
        chart('five', ''),
        chart('six', '随机发现', {musicList: {invalid: true}}),
    ]},
    // 混合数据仍保持插件顺序，横卡应自动占完整一行。
    {title: '更多', data: [
        chart('mixed-tile', '流行'),
        chart('mixed-preview', '更多热歌', {musicList: preview}),
        chart('last', '最后一个榜单'),
    ]},
];
const PREVIEW_CHARTS = ['热歌榜', '更多热歌'];
const CHART_COUNT = SECTIONS.reduce((sum, section) => sum + section.data.length, 0);

const PLUGINS = [
    {hash: 'netease', name: '网易云音乐'},
    {hash: 'qq', name: 'QQ音乐'},
    {hash: 'kugou', name: '酷狗'},
    {hash: 'bili', name: 'Bilibili'},
    // 特别长的名字在标签里截断，不把标签撑宽
    {hash: 'long', name: '一个名字特别长的自建音源（备用线路）'},
];
const LONG_PLUGIN_NAME = PLUGINS[PLUGINS.length - 1].name;

/**
 * 检查榜单面板（board，面板里的滚动视图）里的卡片：都在页边距以内、互不重叠；
 * 文字不被裁；横卡占满一行、文字不压到封面；方卡保持正方形，标题条至少露出上面
 * 1/6 的封面。
 * @param {{left: number, right: number}} bounds 卡片可以排到的左右边界
 */
function assertCharts(board, bounds, {portrait}) {
    const cards = findAll(board, node => node.props.accessibilityRole === 'button');
    assert.equal(cards.length, CHART_COUNT);
    for (const card of cards) {
        const name = card.props.accessibilityLabel;
        assert.ok(card.frame.x >= bounds.left - 0.5, `card ${name} keeps the left margin`);
        assert.ok(card.frame.x + card.frame.width <= bounds.right + 0.5, `card ${name} keeps the right margin`);
        assert.ok(card.frame.height >= 44);
        const texts = findAll(card, isText);
        for (const text of texts) {
            assertReadable(text, `"${text.text}" in card ${name}`);
            assert.ok(contains(card.frame, text.frame, 1), `"${text.text}" stays in card ${name}`);
            assert.equal(clippingAncestor(text), null, `"${text.text}" is not clipped`);
        }
        if (PREVIEW_CHARTS.includes(name)) {
            assert.ok(Math.abs(card.frame.width - (bounds.right - bounds.left)) < 1, `preview card ${name} spans the row`);
            const cover = findAll(card, node => node.type === 'Image')[0];
            assert.ok(contains(card.frame, cover.frame, 1));
            for (const text of texts) {
                assert.ok(text.frame.x + text.frame.width + 10 <= cover.frame.x, `"${text.text}" keeps clear of the cover`);
            }
        } else {
            assert.ok(Math.abs(card.frame.width - card.frame.height) < 1, `tile ${name} stays square`);
            // 标题条压在方卡底部：字体放大时最多盖住 5/6，上面总能看到一截封面
            const [title] = texts;
            const strip = title.parent;
            assert.ok(
                strip.frame.y - card.frame.y >= card.frame.height / 6 - 0.5,
                `title strip ${describeFrame(strip.frame)} leaves the top of tile ${name} ${describeFrame(card.frame)} visible`,
            );
        }
    }
    // 普通手机三列；测量窄面板时不能仍按整个窗口宽度排。
    if (portrait) {
        assert.ok(Math.abs(cards[1].frame.y - cards[3].frame.y) < 1);
        assert.ok(cards[4].frame.y >= cards[1].frame.y + cards[1].frame.height + 10);
    }
    for (let i = 0; i < cards.length; i++) {
        for (const next of cards.slice(i + 1)) {
            const a = cards[i].frame;
            const b = next.frame;
            const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            assert.ok(overlapX <= 0.5 || overlapY <= 0.5, 'cards do not overlap');
        }
    }
    return cards;
}

// 榜单面板本身：窗口里只占一部分宽度时（平板分栏）也按面板实际宽度排
const PANEL_DEVICES = [
    {width: 320, height: 640, panelWidth: 320},
    {width: 363, height: 806, panelWidth: 363},
    {width: 412, height: 806, panelWidth: 300},
    {width: 800, height: 363, panelWidth: 704},
];

for (const device of PANEL_DEVICES) {
    for (const language of LANGUAGES) {
        for (const fontScale of FONT_SCALES) {
            test(`charts in ${device.panelWidth} dp panel, ${language}, font scale ${fontScale}`, () => {
                const env = createEnv({...device, language, fontScale});
                const loader = createModuleLoader({
                    ...createCommonStubs(env),
                    '@/components/base/listEmpty': strictStub('listEmpty', {default: () => null}),
                    '@/components/base/loading': strictStub('loading', {default: () => null}),
                    '@/components/musicBar/useMusicBarFloatingOffset': strictStub('floatingOffset', {default: extra => 68 + extra}),
                });
                const BoardPanel = loader.load('@/pages/topList/components/boardPanel').default;
                const {RequestStateCode} = loader.load('@/constants/commonConst');
                // 字体缩放跟着榜单页（top-list 路由）的登记
                const {root, unmount} = renderLayout(
                    inAppFontScaleScope(loader, {route: 'top-list'},
                        h('View', {style: {width: device.panelWidth, height: device.height}},
                            h(BoardPanel, {hash: 'source', topListData: {state: RequestStateCode.FINISHED, data: SECTIONS}}))),
                    {env, width: device.width, height: device.height},
                );
                try {
                    const board = findOne(root, node => node.type === 'ScrollView', 'board');
                    assertCharts(board, {left: PAGE_MARGIN, right: device.panelWidth - PAGE_MARGIN}, {portrait: device.width < device.height});
                } finally {
                    unmount();
                }
            });
        }
    }
}

// 整页：标题栏、音源标签、榜单面板放在页面里
const PAGE_DEVICES = [
    {name: '320×640', width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {name: "the user's phone 363×806", width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
    {name: 'landscape 806×363', width: 806, height: 363, scale: 3.5, insets: {top: 0, right: 24, bottom: 20, left: 24}},
];

/**
 * @param {'FINISHED' | 'ERROR' | null} options.state 第一个音源的榜单请求状态，null 是还没请求（加载中）
 */
function renderPage(env, {plugins = PLUGINS, state = 'FINISHED', sections = SECTIONS} = {}) {
    const loaderRef = {current: null};
    const topLists = () => {
        const {RequestStateCode} = loaderRef.current.load('@/constants/commonConst');
        return state && plugins.length
            ? {[plugins[0].hash]: {state: RequestStateCode[state], data: sections}}
            : {};
    };
    const loader = createModuleLoader({
        ...createPageStubs(env),
        '@/core/pluginManager': strictStub('@/core/pluginManager', {
            default: {getSortedPluginsWithAbility: () => plugins},
        }),
        'react-native-tab-view': createTabViewStub(),
        // 各音源的榜单放在 jotai 的 atom 里，请求由 useGetTopList 发出
        jotai: strictStub('jotai', {
            atom: initial => ({initial}),
            useAtomValue: () => topLists(),
        }),
        '@/pages/topList/hooks/useGetTopList': strictStub('useGetTopList', {
            default: () => () => {},
        }),
    });
    loaderRef.current = loader;
    const TopList = loader.load('@/pages/topList').default;
    const rendered = renderLayout(
        inAppFontScaleScope(loader, {route: 'top-list'}, h(TopList)),
        {env, width: env.window.width, height: env.window.height},
    );
    return {
        ...rendered,
        t: loader.load('@/core/i18n').default.t,
        fontSizes: loader.load('@/constants/uiConst').fontSizeConst,
    };
}

function safeArea(device) {
    return {
        left: device.insets.left,
        right: device.width - device.insets.right,
        top: device.insets.top,
        bottom: device.height - device.insets.bottom,
    };
}

for (const device of PAGE_DEVICES) {
    for (const language of LANGUAGES) {
        for (const fontScale of FONT_SCALES) {
            const where = `${device.name}, ${language}, font scale ${fontScale}`;

            test(`top list page on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, fontSizes} = renderPage(env);
                const area = safeArea(device);
                try {
                    // 标题栏：标题一行完整显示，不压到返回按钮；返回按钮在安全区里
                    const title = findOne(root, byText(t('topList.title')), 'page title');
                    // 这一页登记过（fontScaleMigration），ThemeText 跟随系统字体
                    assert.equal(title.metrics.fontSize, fontSizes.appbar * fontScale, 'the page follows the system font');
                    assertReadable(title, 'page title');
                    assert.ok(!title.textInfo.truncated, 'page title is shown in full');
                    assert.ok(contains(title.parent.frame, title.frame, 1), 'title stays in the app bar');
                    const back = findOne(root, record => record.props.accessibilityLabel === 'back', 'back button');
                    assert.ok(back.frame.x >= area.left - 0.5, `back button ${describeFrame(back.frame)} is inside the safe area`);
                    assert.ok(back.frame.x + back.frame.width <= title.frame.x + 0.5, 'title does not cover the back button');

                    const tabBarBottom = assertSourceTabs(root, PLUGINS.map(plugin => plugin.name), LONG_PLUGIN_NAME);

                    // 榜单：在音源标签下面，卡片在安全区的页边距以内
                    const sectionTitles = SECTIONS.map(section => findOne(root, byText(section.title), `section ${section.title}`));
                    for (const sectionTitle of sectionTitles) {
                        assertReadable(sectionTitle, `section ${sectionTitle.text}`);
                        assert.ok(sectionTitle.frame.y >= tabBarBottom - 0.5, `section ${sectionTitle.text} is below the source tabs`);
                        assert.ok(sectionTitle.frame.x >= area.left + PAGE_MARGIN - 0.5);
                        assert.ok(sectionTitle.frame.x + sectionTitle.frame.width <= area.right - PAGE_MARGIN + 1);
                    }
                    let board = sectionTitles[0];
                    while (board.type !== 'ScrollView') {
                        board = board.parent;
                    }
                    const cards = assertCharts(
                        board,
                        {left: area.left + PAGE_MARGIN, right: area.right - PAGE_MARGIN},
                        {portrait: device.width < device.height},
                    );

                    // 滚到底时最后一张卡片露在迷你播放器上面
                    let content = cards[cards.length - 1].parent;
                    while (content.type !== 'ScrollContent') {
                        content = content.parent;
                    }
                    const lastBottom = Math.max(...cards.map(card => card.frame.y + card.frame.height));
                    const spaceBelowLast = content.frame.y + content.frame.height - lastBottom;
                    const {reservedBottom} = pageMusicBarLayout();
                    assert.ok(
                        spaceBelowLast >= reservedBottom - 0.5,
                        `only ${spaceBelowLast.toFixed(1)} dp below the last chart; the mini player needs ${reservedBottom}`,
                    );
                } finally {
                    unmount();
                }
            });

            test(`top list page while loading, ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t} = renderPage(env, {state: null});
                const area = safeArea(device);
                try {
                    const loading = findOne(root, byText(t('common.loading')), 'loading');
                    assertReadable(loading, 'loading');
                    assert.ok(loading.frame.x >= area.left && loading.frame.x + loading.frame.width <= area.right + 1);
                    assert.equal(clippingAncestor(loading), null);
                } finally {
                    unmount();
                }
            });

            test(`top list page that failed to load, ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t} = renderPage(env, {state: 'ERROR', sections: []});
                const area = safeArea(device);
                try {
                    for (const key of ['common.error', 'common.clickToRetry']) {
                        const text = findOne(root, byText(t(key)), key);
                        assertReadable(text, key);
                        assert.ok(text.frame.x >= area.left - 0.5 && text.frame.x + text.frame.width <= area.right + 1, `${key} stays on screen`);
                        assert.equal(clippingAncestor(text), null, `${key} is not clipped`);
                    }
                    const retry = findOne(root, byText(t('common.clickToRetry')), 'retry');
                    assert.ok(contains(retry.parent.frame, retry.frame, 1), 'retry text fits its button');
                } finally {
                    unmount();
                }
            });

            test(`top list page without plugins, ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t} = renderPage(env, {plugins: []});
                const area = safeArea(device);
                try {
                    const texts = [
                        findOne(root, byText(t('noPlugin.titleWithType', {type: t('topList.title')})), 'no-plugin title'),
                        findOne(root, byText(t('noPlugin.description')), 'no-plugin description'),
                    ];
                    for (const text of texts) {
                        assertReadable(text, `"${text.text}"`);
                        assert.ok(
                            text.frame.x >= area.left + PAGE_MARGIN - 0.5 &&
                                text.frame.x + text.frame.width <= area.right - PAGE_MARGIN + 1,
                            `"${text.text}" ${describeFrame(text.frame)} keeps the page margins`,
                        );
                        const offCenter = text.frame.x + text.frame.width / 2 - (area.left + area.right) / 2;
                        assert.ok(Math.abs(offCenter) <= 1, `"${text.text}" is centered (off by ${offCenter.toFixed(1)} dp)`);
                        assert.equal(clippingAncestor(text), null);
                    }
                } finally {
                    unmount();
                }
            });
        }
    }
}

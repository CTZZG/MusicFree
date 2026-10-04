// 搜索页（主页的「搜索」标签）：搜索框、搜索历史，搜索后的类别、来源两层标签和单曲、
// 专辑、作者、歌单四种结果，搜索中、没有插件、来源失败，以及长按单曲进入的多选。
// 按 1、1.3、1.5、2 倍系统字体排版：文字不被裁掉、不挤成一条缝，控件之间不互相压住，
// 都在安全区里；滚到底时最后一项露在底部标签栏和迷你播放器上面。
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
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
    flattenStyle,
    isText,
    renderLayout,
    strictStub,
} from './harness.mjs';
import {
    FlashListGrid,
    createCommonStubs,
    createEnv,
    createTabViewStub,
    homeTabMusicBarLayout,
    inAppFontScaleScope,
} from './stubs.mjs';

const h = React.createElement;
const require = createRequire(import.meta.url);
// 搜索词、是否在编辑放在 jotai 的 atom 里：用真的 jotai，每次渲染包一个 Provider，互不影响
const jotai = require('jotai');

const PAGE_MARGIN = 16;
const FONT_SCALES = [1, 1.3, 1.5, 2];
const LANGUAGES = ['zh-CN', 'en-US'];
const QUERY = '周杰伦';

const PLUGINS = [
    {hash: 'netease', name: '网易云音乐'},
    {hash: 'qq', name: 'QQ音乐'},
    // 特别长的名字在标签里截断，不把标签撑宽
    {hash: 'long', name: '一个名字特别长的自建音源（备用线路）'},
];
const LONG_PLUGIN_NAME = PLUGINS[2].name;

const HISTORY = [
    '周杰伦',
    '晴天',
    'Taylor Swift',
    'Lo-Fi',
    // 特别长的关键词放不下时截断成一行，不伸出页面
    '一个特别特别长的搜索关键词：那些年我们一起听过的歌 Live Version',
];
const LONG_KEYWORD = HISTORY[HISTORY.length - 1];

const makeSong = (id, title, extra = {}) => ({
    id,
    title,
    artist: '周杰伦',
    album: '叶惠美',
    platform: '网易云',
    artwork: `art-${id}`,
    duration: 245,
    ...extra,
});
const SONGS = [
    makeSong('1', '晴天'),
    makeSong('2', '一首名字特别特别长的中文歌曲（现场版）', {album: '2004 无与伦比演唱会 Live'}),
    makeSong('3', 'Whatever Happens in a Very Long Song Title', {artist: 'Michael Jackson', album: 'Invincible'}),
    makeSong('4', 'Ready for War', {artist: 'Artist', album: ''}),
    makeSong('5', '稻香', {platform: 'QQ音乐'}),
    makeSong('6', '最后一首歌'),
];

const ALBUMS = [
    {id: 'a1', platform: '网易云', title: '叶惠美', artist: '周杰伦', date: '2003-07-31', artwork: 'a1'},
    {id: 'a2', platform: '网易云', title: 'Thriller 25 Super Deluxe Edition (Remastered)', artist: 'Michael Jackson', date: '2008-02-08', artwork: 'a2'},
    // 没有发行日期
    {id: 'a3', platform: 'QQ音乐', title: '2004 无与伦比演唱会 Live（豪华版）', artist: '周杰伦', artwork: 'a3'},
];

const ARTISTS = [
    {id: 'r1', platform: '网易云', name: '周杰伦', avatar: 'r1', worksNum: 523, description: '华语流行乐男歌手、音乐人、导演'},
    {id: 'r2', platform: '网易云', name: 'Michael Jackson', avatar: 'r2', desc: 'King of Pop'},
    {id: 'r3', platform: 'QQ音乐', name: '一个名字特别长的乐队 The Very Long Band Name', avatar: 'r3', worksNum: 12},
];

const SHEETS = [
    {id: 's1', title: '华语经典：那些年我们一起听过的歌', artwork: 's1'},
    {id: 's2', title: 'Late Night Lo-Fi Beats to Study and Relax', artwork: 's2'},
    {id: 's3', title: '纯音乐', artwork: 's3'},
    {id: 's4', title: '周杰伦 · 全部专辑合集（持续更新）', artwork: 's4'},
    {id: 's5', title: '', artwork: 's5'},
].map(sheet => ({...sheet, platform: '网易云'}));

const DEVICES = [
    {name: '320×640', width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {name: "the user's phone 363×806", width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
    {name: 'landscape 806×363', width: 806, height: 363, scale: 3.5, insets: {top: 0, right: 24, bottom: 20, left: 24}},
];

function noop() {}

/**
 * 每个来源、每种类型的结果。单曲：第一个来源加载完，第二个还在加载下一页，第三个
 * 超时；专辑：第二个来源没有结果，第三个超时。allFailed：所有来源都没连上。
 */
function buildResults(RequestStateCode, {allFailed = false} = {}) {
    const result = (state, data, failure) => ({
        state: RequestStateCode[state],
        query: QUERY,
        page: data.length ? 1 : 0,
        data,
        ...(failure ? {failure} : {}),
    });
    const timeout = {kind: 'timeout', message: 'timeout', page: 1};
    if (allFailed) {
        const failed = () => result('ERROR', [], {kind: 'network', message: 'Network request failed', page: 1});
        const everySource = () => Object.fromEntries(PLUGINS.map(plugin => [plugin.hash, failed()]));
        return {music: everySource(), album: everySource(), artist: everySource(), sheet: everySource(), lyric: {}};
    }
    return {
        music: {
            netease: result('FINISHED', SONGS),
            qq: result('PENDING_REST_PAGE', SONGS.slice(0, 3)),
            long: result('ERROR', [], timeout),
        },
        album: {
            netease: result('FINISHED', ALBUMS),
            qq: result('FINISHED', []),
            long: result('ERROR', [], timeout),
        },
        artist: {netease: result('FINISHED', ARTISTS)},
        sheet: {netease: result('FINISHED', SHEETS)},
        lyric: {},
    };
}

/**
 * @param {object} options
 * @param {'idle' | 'pending' | 'settled' | 'no-source'} options.phase 搜索会话的阶段
 * @param {object} options.params 路由参数；有 initialQuery 时一打开就开始搜索（退出编辑）
 */
function renderSearch(env, {phase = 'idle', params = {}, allFailed = false} = {}) {
    const musicBar = homeTabMusicBarLayout();
    let snapshot = null;
    const session = {
        getSnapshot: () => snapshot,
        subscribe: () => noop,
        start: noop,
        reset: noop,
        ensureLoaded: noop,
        retry: noop,
        refresh: noop,
        loadMore: noop,
    };
    const loader = createModuleLoader({
        ...createCommonStubs(env),
        jotai,
        '@react-navigation/native': strictStub('@react-navigation/native', {
            useNavigation: () => ({addListener: () => noop, isFocused: () => true}),
        }),
        '@/core/theme': strictStub('@/core/theme', {
            default: {useTheme: () => ({dark: false})},
        }),
        '@/core/router': strictStub('@/core/router', {
            ROUTE_PATH: new Proxy({}, {get: (_, key) => String(key)}),
            useNavigate: () => noop,
            useParams: () => params,
        }),
        // 真实的 useMusicBarFloatingOffset 读这份布局状态
        '@/components/musicBar/layoutState': strictStub('musicBarLayoutState', {
            useMusicBarLayoutState: () => ({layout: musicBar}),
        }),
        '@/core/search': strictStub('@/core/search', {default: session}),
        '@/pages/searchPage/common/historySearch': strictStub('historySearch', {
            // 同步的 thenable：第一次排版就有历史记录
            getHistory: () => ({then: resolve => resolve(HISTORY)}),
            addHistory: async () => {},
            removeHistory: async () => {},
            removeAllHistory: async () => {},
        }),
        '@/core/pluginManager': strictStub('@/core/pluginManager', {
            default: {
                getSortedSearchablePlugins: () => PLUGINS,
                getByHash: () => null,
                getByMedia: () => ({instance: {}}),
            },
            usePluginEnabledRevision: () => 0,
        }),
        'react-native-tab-view': createTabViewStub(),
        '@shopify/flash-list': strictStub('@shopify/flash-list', {FlashList: FlashListGrid}),
        '@/components/dialogs/useDialog': strictStub('useDialog', {showDialog: noop}),
        '@/core/trackPlayer': strictStub('@/core/trackPlayer', {
            default: {
                repeatMode: 'QUEUE',
                play: noop,
                playWithReplacePlayList: noop,
                addNext: noop,
                addPlayLater: noop,
            },
            useCurrentMusic: () => SONGS[0],
        }),
        '@/core/musicSheet': strictStub('@/core/musicSheet', {
            default: {defaultSheet: {id: 'favorite'}, removeMusic: noop},
        }),
        '@/core/localMusicSheet': strictStub('@/core/localMusicSheet', {
            default: {useLocalFileExists: () => undefined, useLocalMusic: () => null, removeMusic: noop},
        }),
        '@/core/musicHistory': strictStub('@/core/musicHistory', {default: {removeMusic: noop}}),
        '@/core/downloader': strictStub('@/core/downloader', {default: {download: noop}}),
        // 只在下载中、下载过的歌曲上显示，这里的歌都没下载
        '@/components/downloadStatusIndicator': strictStub('downloadStatusIndicator', {default: () => null}),
        '@/utils/mediaExtra': strictStub('@/utils/mediaExtra', {
            useMediaExtraProperty: () => undefined,
            getMediaExtraProperty: () => undefined,
        }),
        '@/hooks/useLocalMusicArtwork': strictStub('useLocalMusicArtwork', {
            default: ({artwork}) => artwork,
        }),
    });
    const {RequestStateCode} = loader.load('@/constants/commonConst');
    snapshot = {id: 1, query: QUERY, phase, results: buildResults(RequestStateCode, {allFailed})};
    const SearchPage = loader.load('@/pages/searchPage').default;
    const rendered = renderLayout(
        h(jotai.Provider, null, inAppFontScaleScope(loader, {homeTab: 'search-page'}, h(SearchPage))),
        {env, width: env.window.width, height: env.window.height},
    );
    return {
        ...rendered,
        t: loader.load('@/core/i18n').default.t,
        musicBar,
    };
}

/** 页面的安全区：四边都让开 */
function safeArea(device) {
    return {
        left: device.insets.left,
        right: device.width - device.insets.right,
        top: device.insets.top,
        bottom: device.height - device.insets.bottom,
    };
}

const rightOf = frame => frame.x + frame.width;
const bottomOf = frame => frame.y + frame.height;
const byLabel = label => record => record.props.accessibilityLabel === label;
const isButton = label => record => record.props.accessibilityRole === 'button' && record.props.accessibilityLabel === label;

/** 文字的宽度按像素向上取整，比较文字时容差 1 dp */
function assertInside(record, bounds, what) {
    const tolerance = isText(record) ? 1 : 0.5;
    assert.ok(
        record.frame.x >= bounds.left - tolerance && rightOf(record.frame) <= bounds.right + tolerance,
        `${what} ${describeFrame(record.frame)} stays between x=${bounds.left} and x=${bounds.right}`,
    );
}

function assertNoOverlap(records, what) {
    for (let i = 0; i < records.length; i++) {
        for (const other of records.slice(i + 1)) {
            const a = records[i].frame;
            const b = other.frame;
            const overlapX = Math.min(rightOf(a), rightOf(b)) - Math.max(a.x, b.x);
            const overlapY = Math.min(bottomOf(a), bottomOf(b)) - Math.max(a.y, b.y);
            assert.ok(overlapX <= 0.5 || overlapY <= 0.5, `${what}: ${describeFrame(a)} and ${describeFrame(b)} overlap`);
        }
    }
}

/** 去掉内边距以后放内容的区域 */
function paddingInset(record) {
    const style = flattenStyle(record.props.style);
    const edge = (side, axis) => style[`padding${side}`] ?? style[`padding${axis}`] ?? style.padding ?? 0;
    const left = edge('Left', 'Horizontal');
    const right = edge('Right', 'Horizontal');
    const top = edge('Top', 'Vertical');
    const bottom = edge('Bottom', 'Vertical');
    return {
        x: record.frame.x + left,
        y: record.frame.y + top,
        width: record.frame.width - left - right,
        height: record.frame.height - top - bottom,
    };
}

/** 文字排在哪一段：去掉文字自己左右的内边距（大标题的页边距写在文字上） */
function textSpan(text) {
    const style = flattenStyle(text.props.style);
    const left = style.paddingLeft ?? style.paddingHorizontal ?? style.padding ?? 0;
    const right = style.paddingRight ?? style.paddingHorizontal ?? style.padding ?? 0;
    return {...text, frame: {...text.frame, x: text.frame.x + left, width: text.frame.width - left - right}};
}

function scrollContentOf(record) {
    let content = record;
    while (content.type !== 'ScrollContent') {
        content = content.parent;
    }
    return content;
}

/** 滚到底时最后一项露在底部标签栏和迷你播放器上面（页面底边已经让开了系统的安全区） */
function assertClearsBottomBars(items, musicBar, what) {
    const content = scrollContentOf(items[items.length - 1]);
    const lastBottom = Math.max(...items.map(item => bottomOf(item.frame)));
    const spaceBelowLast = bottomOf(content.frame) - lastBottom;
    assert.ok(
        spaceBelowLast >= musicBar.reservedBottom - 0.5,
        `only ${spaceBelowLast.toFixed(1)} dp below the last ${what}; the tab bar and mini player need ${musicBar.reservedBottom}`,
    );
}

/**
 * 搜索框：至少 36 高，输入的文字（一行）不被裁掉；整个框都能点进输入框；在页边距里。
 * @returns 搜索框
 */
function assertSearchField(root, area, t) {
    const input = findOne(root, record => record.type === 'TextInput', 'search input');
    assert.equal(input.props.accessibilityLabel, t('searchPage.searchLabel.a11y'));
    const field = input.parent;
    assert.ok(field.frame.height >= 36 - 0.5, `search field ${describeFrame(field.frame)} is at least 36 dp tall`);
    assert.ok(
        input.frame.height >= input.metrics.lineHeight - 0.5,
        `typed text (line height ${input.metrics.lineHeight.toFixed(1)}) fits the input ${describeFrame(input.frame)}`,
    );
    // 输入框按像素向上取整，和框相差不到 1 dp
    assert.ok(
        Math.abs(input.frame.y - field.frame.y) <= 1 && Math.abs(input.frame.height - field.frame.height) <= 1,
        `the input ${describeFrame(input.frame)} fills the field ${describeFrame(field.frame)}: tapping anywhere in it starts typing`,
    );
    assertInside(field, {left: area.left + PAGE_MARGIN, right: area.right - PAGE_MARGIN}, 'search field');
    assert.ok(field.frame.y >= area.top - 0.5, 'search field is below the status bar');
    return {input, field};
}

/** 取消按钮：文字完整显示，在搜索框右边，在页边距里 */
function assertCancel(root, area, t, field) {
    const cancel = findOne(root, isButton(t('common.cancel')), 'cancel button');
    const [label] = findAll(cancel, isText);
    assertReadable(label, 'cancel');
    assert.ok(!label.textInfo.truncated, 'cancel is shown in full');
    assert.ok(cancel.frame.x >= rightOf(field.frame) - 0.5, 'cancel is right of the search field');
    assertInside(cancel, {left: area.left + PAGE_MARGIN, right: area.right - PAGE_MARGIN}, 'cancel button');
    assert.equal(clippingAncestor(label), null);
}

/** 标签朗读的内容：界面语言的名字，后面跟着结果数、加载中或失败（和 App 一样拼） */
const tabLabelOf = ({title, meta}) => (meta ? `${title}, ${meta}` : title);

/**
 * 一层标签（类别或来源）：按界面语言朗读；至少 48 高；每个标签里选中、未选中两份都是
 * 名字加一行说明，名字和说明完整显示（特别长的来源名截断成一行），不出标签、不被裁掉。
 * @param {Array<{title: string, meta: string}>} expected 按顺序
 * @returns 这一层标签
 */
function assertResultTabs(root, expected, what) {
    const tabs = expected.map(tab => findOne(root, record => record.props.accessibilityRole === 'tab' && record.props.accessibilityLabel === tabLabelOf(tab), `${what} tab ${tabLabelOf(tab)}`));
    for (const [index, tab] of tabs.entries()) {
        const {title, meta} = expected[index];
        const label = tabLabelOf(expected[index]);
        assert.ok(tab.frame.height >= 48 - 0.5, `${what} tab ${label} ${describeFrame(tab.frame)} is at least 48 dp tall`);
        const texts = findAll(tab, isText);
        const titles = texts.filter(text => text.text === title);
        const metas = texts.filter(text => text.text === meta);
        // 两份标签各有一个看得见的名字（还可能有按粗体占位的、看不见的一份）和一行说明
        assert.ok(titles.length >= 2, `${what} tab ${label} shows its name twice (focused and unfocused copies)`);
        assert.equal(metas.length, 2, `${what} tab ${label} shows "${meta}" twice`);
        for (const text of [...titles, ...metas]) {
            assertReadable(text, `"${text.text}" in ${what} tab ${label}`);
            assert.equal(text.textInfo.shownLines, 1, `"${text.text}" stays on one line`);
            assert.equal(
                text.textInfo.truncated,
                text.text === LONG_PLUGIN_NAME,
                text.text === LONG_PLUGIN_NAME
                    ? 'the long source name is cut short'
                    : `"${text.text}" (weight ${flattenStyle(text.props.style).fontWeight}) in ${what} tab ${label} is shown in full`,
            );
            assert.ok(contains(tab.frame, text.frame, 1), `"${text.text}" stays in its tab`);
            assert.equal(clippingAncestor(text), null, `"${text.text}" in ${what} tab ${label} is not cut off`);
        }
        // 说明在名字下面
        const shownTitle = titles.find(text => flattenStyle(text.props.style).opacity !== 0);
        assert.ok(metas[0].frame.y >= bottomOf(shownTitle.frame) - 1, `"${meta}" is below "${title}"`);
    }
    return tabs;
}

/** 类别标签（单曲、专辑、作者、歌单）：说明是各来源结果数的合计 */
function categoryTabs(t) {
    return [
        // 还有来源在加载下一页
        {title: t('common.singleMusic'), meta: `${SONGS.length + 3}...`},
        {title: t('common.album'), meta: `${ALBUMS.length}`},
        {title: t('common.artist'), meta: `${ARTISTS.length}`},
        {title: t('common.sheet'), meta: `${SHEETS.length}`},
    ];
}

/** 列表行（专辑、作者、单曲）：至少 64 高、占满安全区的宽度、互不重叠；行里的文字一行（可以截断），不出行、不被裁 */
function assertRows(rows, area, what) {
    assert.ok(rows.length > 0, `${what} has rows`);
    for (const row of rows) {
        const name = row.props.accessibilityLabel;
        assert.ok(row.frame.height >= 64 - 0.5, `${what} row ${name} ${describeFrame(row.frame)} is at least 64 dp tall`);
        assert.ok(
            Math.abs(row.frame.x - area.left) <= 0.5 && Math.abs(rightOf(row.frame) - area.right) <= 0.5,
            `${what} row ${name} ${describeFrame(row.frame)} spans the safe area x=${area.left}…${area.right}`,
        );
        for (const text of findAll(row, isText)) {
            assertReadable(text, `"${text.text}" in ${what} row ${name}`);
            assert.equal(text.textInfo.shownLines, 1, `"${text.text}" stays on one line`);
            assert.ok(contains(row.frame, text.frame, 1), `"${text.text}" stays in ${what} row ${name}`);
            assert.equal(clippingAncestor(text), null, `"${text.text}" is not clipped`);
        }
        for (const image of findAll(row, record => record.type === 'Image')) {
            assert.ok(contains(row.frame, image.frame, 0.5), `the picture stays in ${what} row ${name}`);
        }
    }
    assertNoOverlap(rows, `${what} rows`);
}

/** 标题后面的来源角标（TitleAndTag）：完整显示，在标题右边 */
function assertTitleTag(row, title, tag) {
    const titleText = findOne(row, byText(title), `title ${title}`);
    const tagText = findOne(row, byText(tag), `tag ${tag} of ${title}`);
    assert.ok(!tagText.textInfo.truncated, `tag ${tag} is shown in full`);
    assert.ok(contains(tagText.parent.frame, tagText.frame, 1), `tag ${tag} ${describeFrame(tagText.frame)} fits its frame ${describeFrame(tagText.parent.frame)}`);
    assert.ok(tagText.parent.frame.x >= rightOf(titleText.frame) - 0.5, `tag ${tag} is right of the title`);
    return titleText;
}

/** 类别、来源两层标签在搜索框下面，结果在标签下面 */
function assertResultLayout(root, area, t, {category, source}) {
    const {field} = assertSearchField(root, area, t);
    assertCancel(root, area, t, field);
    const categories = assertResultTabs(root, categoryTabs(t), 'category');
    const sources = assertResultTabs(root, source, 'source');
    const categoryBottom = Math.max(...categories.map(tab => bottomOf(tab.frame)));
    assert.ok(Math.min(...categories.map(tab => tab.frame.y)) >= bottomOf(field.frame) - 0.5, 'category tabs are below the search field');
    assert.ok(Math.min(...sources.map(tab => tab.frame.y)) >= categoryBottom - 0.5, 'source tabs are below the category tabs');
    assert.ok(categories[0].frame.x >= area.left - 0.5 && sources[0].frame.x >= area.left - 0.5, `tabs start inside the safe area (${category})`);
    return Math.max(...sources.map(tab => bottomOf(tab.frame)));
}

for (const device of DEVICES) {
    for (const language of LANGUAGES) {
        for (const fontScale of FONT_SCALES) {
            const where = `${device.name}, ${language}, font scale ${fontScale}`;

            test(`search history while typing on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, musicBar} = renderSearch(env);
                const area = safeArea(device);
                const content = {left: area.left + PAGE_MARGIN, right: area.right - PAGE_MARGIN};
                try {
                    // 一进来就在输入：没有大标题，搜索框右边是取消
                    assert.equal(findAll(root, byText(t('common.search'))).length, 0, 'no large title while typing');
                    const {field} = assertSearchField(root, area, t);
                    assertCancel(root, area, t, field);

                    // 历史记录标题和清空：这一页跟随系统字体
                    const title = findOne(root, byText(t('searchPage.history')), 'history title');
                    assert.equal(title.metrics.fontSize, 20 * fontScale, 'the page follows the system font');
                    const clear = findOne(root, isButton(t('common.clear')), 'clear history');
                    for (const text of [title, findAll(clear, isText)[0]]) {
                        assertReadable(text, `"${text.text}"`);
                        assert.ok(!text.textInfo.truncated, `"${text.text}" is shown in full`);
                        assertInside(text, content, `"${text.text}"`);
                        assert.ok(text.frame.y >= bottomOf(field.frame) - 0.5, `"${text.text}" is below the search field`);
                    }
                    assertNoOverlap([title, clear], 'history header');

                    // 历史关键词：每个一行（特别长的截断），在页边距里，互不重叠；删除按钮在关键词里
                    const chips = HISTORY.map(keyword => findOne(root, isButton(keyword), `keyword ${keyword}`));
                    for (const [index, chip] of chips.entries()) {
                        const keyword = HISTORY[index];
                        assertInside(chip, content, `keyword ${keyword}`);
                        assert.ok(chip.frame.y >= bottomOf(clear.frame) - 0.5, `keyword ${keyword} is below the header`);
                        const text = findOne(chip, byText(keyword), `text of ${keyword}`);
                        assertReadable(text, `keyword ${keyword}`);
                        assert.equal(text.textInfo.shownLines, 1, `keyword ${keyword} stays on one line`);
                        if (keyword !== LONG_KEYWORD) {
                            assert.ok(!text.textInfo.truncated, `keyword ${keyword} is shown in full`);
                        }
                        // 关键词和删除按钮都在胶囊的内边距里面，不顶到两头的圆角
                        const inside = paddingInset(chip);
                        assert.ok(contains(inside, text.frame, 1), `keyword ${keyword} ${describeFrame(text.frame)} fits inside the padding of its chip ${describeFrame(inside)}`);
                        assert.equal(clippingAncestor(text), null, `keyword ${keyword} is not clipped`);
                        const remove = findOne(chip, byLabel(t('searchPage.history.removeItem.a11y', {keyword})), `remove ${keyword}`);
                        assert.ok(contains(inside, remove.frame, 0.5), `the remove button of ${keyword} ${describeFrame(remove.frame)} stays inside the padding of its chip`);
                        assert.ok(remove.frame.x >= rightOf(text.frame) - 0.5, `the remove button of ${keyword} is right of the keyword`);
                    }
                    assertNoOverlap(chips, 'keywords');
                    assertClearsBottomBars(chips, musicBar, 'keyword');
                } finally {
                    unmount();
                }
            });

            test(`search page with its large title on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const rendered = renderSearch(env);
                const {t} = rendered;
                const area = safeArea(device);
                try {
                    // 收起键盘后显示「搜索」大标题，没有取消
                    const input = findOne(rendered.root, record => record.type === 'TextInput', 'search input');
                    const root = rendered.interact(() => input.props.onBlur());
                    const title = findOne(root, byText(t('common.search')), 'large title');
                    assertReadable(title, 'large title');
                    assert.ok(!title.textInfo.truncated, 'large title is shown in full');
                    assertInside(textSpan(title), {left: area.left + PAGE_MARGIN, right: area.right - PAGE_MARGIN}, 'large title');
                    assert.ok(title.frame.y >= area.top - 0.5, 'large title is below the status bar');
                    const {field} = assertSearchField(root, area, t);
                    assert.ok(bottomOf(title.frame) <= field.frame.y + 0.5, 'large title is above the search field');
                    assert.equal(findAll(root, isButton(t('common.cancel'))).length, 0, 'no cancel button');
                } finally {
                    rendered.unmount();
                }
            });

            test(`song results on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, musicBar} = renderSearch(env, {
                    phase: 'settled',
                    params: {initialQuery: QUERY, initialSearchType: 'music'},
                });
                const area = safeArea(device);
                try {
                    const tabsBottom = assertResultLayout(root, area, t, {
                        category: 'music',
                        source: [
                            {title: PLUGINS[0].name, meta: `${SONGS.length}`},
                            {title: PLUGINS[1].name, meta: '3...'},
                            {title: LONG_PLUGIN_NAME, meta: t('searchPage.sourceTimeoutShort')},
                        ],
                    });
                    const rows = SONGS.map(song => findOne(root, byLabel(`${song.title}, ${song.artist}`), `row ${song.title}`));
                    assertRows(rows, area, 'song');
                    for (const [index, row] of rows.entries()) {
                        const song = SONGS[index];
                        assert.ok(row.frame.y >= tabsBottom - 0.5, `row ${song.title} is below the tabs`);
                        const title = assertTitleTag(row, song.title, song.platform);
                        const details = findAll(row, isText).filter(text => text.frame.y >= bottomOf(title.frame) - 0.5);
                        assert.ok(details.length >= 1, `row ${song.title} has its artist line below the title`);
                        // 「更多」的点击区域是整行的高度，加上左右的 hitSlop 至少 44 宽
                        const more = findOne(row, byLabel(t('musicList.item.moreOptions.a11y', {title: song.title})), 'more button');
                        const slop = more.props.hitSlop ?? {};
                        assert.ok(
                            Math.abs(more.frame.y - row.frame.y) <= 0.5 && Math.abs(more.frame.height - row.frame.height) <= 0.5,
                            `more button ${describeFrame(more.frame)} spans row ${describeFrame(row.frame)}`,
                        );
                        assert.ok(more.frame.width + (slop.left ?? 0) + (slop.right ?? 0) >= 44 - 0.5, 'more button is at least 44 dp wide to touch');
                        assert.ok(more.frame.x >= rightOf(title.frame) - 0.5, 'more button is right of the title');
                    }
                    const footer = findOne(root, byText(t('common.listReachEnd')), 'end of list');
                    assertReadable(footer, 'end of list');
                    assertClearsBottomBars(rows, musicBar, 'song');
                } finally {
                    unmount();
                }
            });

            test(`song results in selection mode on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const rendered = renderSearch(env, {
                    phase: 'settled',
                    params: {initialQuery: QUERY, initialSearchType: 'music'},
                });
                const {t, musicBar} = rendered;
                const area = safeArea(device);
                try {
                    const firstRow = findOne(rendered.root, byLabel(`${SONGS[0].title}, ${SONGS[0].artist}`), 'first row');
                    const root = rendered.interact(() => firstRow.props.onLongPress());
                    const count = findOne(root, byText(t('musicList.selection.selectedCount', {count: 1})), 'selected count');
                    const headerButtons = ['common.selectAll', 'common.cancel'].map(key =>
                        findAll(root, isButton(t(key))).find(button => Math.abs(button.frame.y - count.frame.y) < 40) ??
                        assert.fail(`${key} is next to the selected count`),
                    );
                    for (const text of [count, ...headerButtons.map(button => findAll(button, isText)[0])]) {
                        assertReadable(text, `"${text.text}"`);
                        assert.ok(!text.textInfo.truncated, `"${text.text}" is shown in full`);
                        assertInside(text, area, `"${text.text}"`);
                        assert.equal(clippingAncestor(text), null, `"${text.text}" is not clipped`);
                    }
                    assertNoOverlap([count, ...headerButtons], 'selection header');

                    // 底部操作栏浮在标签栏和迷你播放器上面，操作的名字都在自己那一格里
                    const bar = findOne(root, byLabel(t('musicListEditor.addToNextPlay')), 'play next').parent;
                    assertInside(bar, area, 'selection bar');
                    assert.ok(
                        bottomOf(bar.frame) <= area.bottom - musicBar.reservedBottom + 0.5,
                        `selection bar ${describeFrame(bar.frame)} is above the tab bar and mini player (they take ${musicBar.reservedBottom} dp above y=${area.bottom})`,
                    );
                    const actions = ['musicListEditor.addToNextPlay', 'playLater.add', 'musicListEditor.addToSheet', 'common.download'].map(key =>
                        findOne(bar, byLabel(t(key)), key),
                    );
                    for (const action of actions) {
                        const [label] = findAll(action, isText);
                        assertReadable(label, `action ${label.text}`);
                        assert.ok(contains(action.frame, label.frame, 1), `action ${label.text} stays in its cell`);
                        assert.ok(contains(bar.frame, action.frame, 0.5), `action ${label.text} stays in the bar`);
                    }
                    assertNoOverlap(actions, 'selection actions');
                } finally {
                    rendered.unmount();
                }
            });

            test(`album results on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, musicBar} = renderSearch(env, {
                    phase: 'settled',
                    params: {initialQuery: QUERY, initialSearchType: 'album'},
                });
                const area = safeArea(device);
                try {
                    const tabsBottom = assertResultLayout(root, area, t, {
                        category: 'album',
                        source: [
                            {title: PLUGINS[0].name, meta: `${ALBUMS.length}`},
                            {title: PLUGINS[1].name, meta: '0'},
                            {title: LONG_PLUGIN_NAME, meta: t('searchPage.sourceTimeoutShort')},
                        ],
                    });
                    const rows = ALBUMS.map(album => {
                        const title = findOne(root, byText(album.title), `album ${album.title}`);
                        let row = title.parent;
                        while (row.props.accessibilityRole !== 'button') {
                            row = row.parent;
                        }
                        return row;
                    });
                    assertRows(rows, area, 'album');
                    for (const [index, row] of rows.entries()) {
                        const album = ALBUMS[index];
                        assert.ok(row.frame.y >= tabsBottom - 0.5, `album ${album.title} is below the tabs`);
                        const title = assertTitleTag(row, album.title, album.platform);
                        const artist = findOne(row, record => isText(record) && record.text.startsWith(album.artist), `artist of ${album.title}`);
                        assert.ok(artist.frame.y >= bottomOf(title.frame) - 0.5, `artist line of ${album.title} is below the title`);
                    }
                    assertClearsBottomBars(rows, musicBar, 'album');
                } finally {
                    unmount();
                }
            });

            test(`artist results on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, musicBar} = renderSearch(env, {
                    phase: 'settled',
                    params: {initialQuery: QUERY, initialSearchType: 'artist'},
                });
                const area = safeArea(device);
                try {
                    const tabsBottom = assertResultLayout(root, area, t, {
                        category: 'artist',
                        // 另外两个来源还没搜过这一类：没有说明
                        source: [{title: PLUGINS[0].name, meta: `${ARTISTS.length}`}],
                    });
                    const rows = ARTISTS.map(artist => {
                        const name = findOne(root, byText(artist.name), `artist ${artist.name}`);
                        let row = name.parent;
                        while (row.props.accessibilityRole !== 'button') {
                            row = row.parent;
                        }
                        return row;
                    });
                    assertRows(rows, area, 'artist');
                    for (const [index, row] of rows.entries()) {
                        const artist = ARTISTS[index];
                        assert.ok(row.frame.y >= tabsBottom - 0.5, `artist ${artist.name} is below the tabs`);
                        const name = assertTitleTag(row, artist.name, artist.platform);
                        const details = findAll(row, isText).filter(text => text.frame.y >= bottomOf(name.frame) - 0.5);
                        assert.equal(details.length, 1, `artist ${artist.name} has one line of details below the name`);
                    }
                    assertClearsBottomBars(rows, musicBar, 'artist');
                } finally {
                    unmount();
                }
            });

            test(`playlist results on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, musicBar} = renderSearch(env, {
                    phase: 'settled',
                    params: {initialQuery: QUERY, initialSearchType: 'sheet'},
                });
                const area = safeArea(device);
                try {
                    const tabsBottom = assertResultLayout(root, area, t, {
                        category: 'sheet',
                        source: [{title: PLUGINS[0].name, meta: `${SHEETS.length}`}],
                    });
                    // 歌单网格：标题最多两行、不出封面的左右；上一行的标题不压到下一行
                    const covers = findAll(root, record => record.type === 'Image');
                    assert.equal(covers.length, SHEETS.length);
                    const tiles = covers.map(cover => ({cover, title: findAll(cover.parent, isText)[0]}));
                    for (const {cover, title} of tiles) {
                        assert.ok(cover.frame.y >= tabsBottom - 0.5, 'grid starts below the tabs');
                        assert.ok(cover.frame.x >= area.left + PAGE_MARGIN - 0.5);
                        assert.ok(rightOf(cover.frame) <= area.right - PAGE_MARGIN + 0.5);
                        assertReadable(title, `sheet title "${title.text}"`);
                        assert.ok(title.textInfo.shownLines <= 2);
                        assert.ok(title.frame.y >= bottomOf(cover.frame) - 0.5);
                        assert.ok(
                            title.frame.x >= cover.frame.x - 0.5 && rightOf(title.frame) <= rightOf(cover.frame) + 1,
                            `"${title.text}" stays within its cover`,
                        );
                        assert.equal(clippingAncestor(title), null, `"${title.text}" is not clipped`);
                    }
                    for (const a of tiles) {
                        for (const b of tiles) {
                            if (b.cover.frame.y > a.cover.frame.y + 0.5) {
                                assert.ok(bottomOf(a.title.frame) <= b.cover.frame.y + 0.5, `"${a.title.text}" does not run into the row below`);
                            }
                        }
                    }
                    assertClearsBottomBars(tiles.map(tile => tile.title), musicBar, 'playlist');
                } finally {
                    unmount();
                }
            });

            test(`a source that timed out on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t} = renderSearch(env, {
                    phase: 'settled',
                    params: {initialQuery: QUERY, initialSearchType: 'album', pluginHash: 'long'},
                });
                const area = safeArea(device);
                try {
                    const texts = [
                        findOne(root, byText(t('searchPage.sourceTimeout', {source: LONG_PLUGIN_NAME})), 'timeout title'),
                        findOne(root, byText(t('searchPage.sourceTimeoutDescription')), 'timeout description'),
                        findOne(root, byText(t('common.clickToRetry')), 'retry'),
                    ];
                    for (const text of texts) {
                        assertReadable(text, `"${text.text}"`);
                        assertInside(text, area, `"${text.text}"`);
                        assert.equal(clippingAncestor(text), null, `"${text.text}" is not clipped`);
                    }
                    for (let i = 1; i < texts.length; i += 1) {
                        assert.ok(texts[i].frame.y >= bottomOf(texts[i - 1].frame) - 0.5, `"${texts[i].text}" is below "${texts[i - 1].text}"`);
                    }
                    const retry = texts[2];
                    assert.ok(contains(retry.parent.frame, retry.frame, 1), 'retry text fits its button');
                } finally {
                    unmount();
                }
            });

            test(`a search where every source failed on ${where}`, () => {
                // 标签上的说明是最长的「加载失败」（英文 Failed to load）
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t} = renderSearch(env, {
                    phase: 'settled',
                    allFailed: true,
                    params: {initialQuery: QUERY, initialSearchType: 'music'},
                });
                const area = safeArea(device);
                try {
                    const failed = t('common.failToLoad');
                    assertSearchField(root, area, t);
                    assertResultTabs(root, categoryTabs(t).map(tab => ({...tab, meta: failed})), 'category');
                    assertResultTabs(root, PLUGINS.map(plugin => ({title: plugin.name, meta: failed})), 'source');
                    const texts = [
                        findOne(root, byText(t('searchPage.sourceLoadFailed', {source: PLUGINS[0].name})), 'error title'),
                        findOne(root, byText('Network request failed'), 'error description'),
                    ];
                    for (const text of texts) {
                        assertReadable(text, `"${text.text}"`);
                        assertInside(text, area, `"${text.text}"`);
                        assert.equal(clippingAncestor(text), null, `"${text.text}" is not clipped`);
                    }
                } finally {
                    unmount();
                }
            });

            test(`searching and no plugins on ${where}`, () => {
                const area = safeArea(device);
                const env = createEnv({...device, language, fontScale});
                const searching = renderSearch(env, {phase: 'pending', params: {initialQuery: QUERY}});
                try {
                    const text = findOne(searching.root, byText(searching.t('common.loading')), 'loading');
                    assertReadable(text, 'loading');
                    assertInside(text, area, 'loading');
                    assertSearchField(searching.root, area, searching.t);
                } finally {
                    searching.unmount();
                }
                const noPlugin = renderSearch(env, {phase: 'no-source', params: {initialQuery: QUERY}});
                try {
                    const {t} = noPlugin;
                    const texts = [
                        findOne(noPlugin.root, byText(t('noPlugin.titleWithType', {type: t('common.search')})), 'no-plugin title'),
                        findOne(noPlugin.root, byText(t('noPlugin.description')), 'no-plugin description'),
                    ];
                    for (const text of texts) {
                        assertReadable(text, `"${text.text}"`);
                        assertInside(text, {left: area.left + PAGE_MARGIN, right: area.right - PAGE_MARGIN}, `"${text.text}"`);
                        assert.equal(clippingAncestor(text), null);
                    }
                    assert.ok(bottomOf(texts[0].frame) <= texts[1].frame.y + 0.5, 'description is below the title');
                } finally {
                    noPlugin.unmount();
                }
            });
        }
    }
}

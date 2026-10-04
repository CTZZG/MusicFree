// 歌单详情、榜单详情、专辑详情（共用 MusicSheetPage）和自己的歌单详情（同样的头部、
// 播放按钮区、歌曲列表）：标题栏、封面和简介、播放按钮区、歌曲行、列表底部提示，
// 长按歌曲进入的多选模式。按 1、1.3、1.5、2 倍系统字体排版，
// 文字不被裁掉、不挤成一条缝，控件之间不互相压住，按钮和歌曲行都留在安全区里。
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
    FlashListGrid,
    createEnv,
    createPageStubs,
    inAppFontScaleScope,
    pageMusicBarLayout,
} from './stubs.mjs';

const h = React.createElement;
const PAGE_MARGIN = 16;
const FONT_SCALES = [1, 1.3, 1.5, 2];
const LANGUAGES = ['zh-CN', 'en-US'];

const SHEET = {
    id: 'sheet',
    platform: '网易云',
    title: '华语经典：那些年我们一起听过的歌 · 致青春',
    artist: '网易云音乐官方歌单',
    artwork: 'cover',
    worksNum: 120,
    description:
        '收录了二十年来传唱度最高的华语流行歌曲，从校园民谣到 KTV 必点曲目。Late night drives, old friends and the songs we used to sing together.',
};

const makeSong = (id, title, extra = {}) => ({
    id,
    title,
    artist: '周杰伦',
    album: '叶惠美',
    platform: '网易云',
    artwork: `art-${id}`,
    duration: 245,
    // 带链接的音质才算拿得到，列表上显示最好的那个（SQ、HR……）
    qualities: {'320k': {url: 'u320'}, flac: {url: 'uflac'}},
    ...extra,
});
const SONGS = [
    makeSong('1', '晴天'),
    makeSong('2', '一首名字特别特别长的中文歌曲（现场版）', {album: '2004 无与伦比演唱会 Live'}),
    makeSong('3', 'Whatever Happens in a Very Long Song Title', {artist: 'Michael Jackson', album: 'Invincible', duration: 296}),
    // 超过一小时的长音频
    makeSong('4', '有声书：第一章', {duration: 3725, qualities: {'128k': {url: 'u128'}}}),
    makeSong('5', 'Ready for War', {artist: 'Artist', album: '', duration: 59}),
    makeSong('6', '稻香', {qualities: {hires: {url: 'uhires'}}}),
    makeSong('7', '最后一首歌', {duration: 1234}),
];
const TOP_LIST = {
    id: 'hot',
    platform: '网易云',
    title: '热歌榜',
    description: '每周四更新',
    coverImg: 'hot',
    musicList: SONGS,
};

const ALBUM = {
    id: 'album',
    platform: '网易云',
    title: '2004 无与伦比演唱会 Live（豪华版）',
    artist: '周杰伦',
    artwork: 'album',
    worksNum: 24,
    description: '收录 2004 年演唱会全部曲目。',
};

// 自己建的歌单：没有作者、简介，有删除、排序等菜单，多选时能从歌单里删掉
const LOCAL_SHEET = {
    id: 'my-sheet',
    platform: '本地',
    title: '通勤路上听的歌 · Morning Commute Mix',
    coverImg: 'mine',
    musicList: SONGS,
};

const PAGES = {
    'plugin-sheet-detail': {
        module: '@/pages/pluginSheetDetail',
        params: {pluginHash: 'p', sheetInfo: SHEET},
    },
    'top-list-detail': {
        module: '@/pages/topListDetail',
        params: {pluginHash: 'p', topList: TOP_LIST},
    },
    'album-detail': {
        module: '@/pages/albumDetail',
        params: {pluginHash: 'p', albumItem: ALBUM},
    },
    'local-sheet-detail': {
        module: '@/pages/sheetDetail',
        params: {id: LOCAL_SHEET.id},
    },
};

const DEVICES = [
    {name: '320×640', width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {name: "the user's phone 363×806", width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
    {name: 'landscape 806×363', width: 806, height: 363, scale: 3.5, insets: {top: 0, right: 24, bottom: 20, left: 24}},
];

function noop() {}

/**
 * @param {keyof typeof PAGES} route
 * @param {{state?: string, musicList?: unknown[] | null}} options 第一页的请求状态和歌曲
 */
function renderDetail(env, route, {state = 'FINISHED', musicList = SONGS} = {}) {
    const loaderRef = {current: null};
    const requestState = () =>
        loaderRef.current.load('@/constants/commonConst').RequestStateCode[state];
    const loader = createModuleLoader({
        ...createPageStubs(env, {params: PAGES[route].params}),
        '@/pages/albumDetail/hooks/useAlbumMusicList': strictStub('useAlbumMusicList', {
            default: () => [requestState(), ALBUM, musicList, noop],
        }),
        '@/components/dialogs/useDialog': strictStub('useDialog', {showDialog: noop}),
        '@/pages/pluginSheetDetail/hooks/usePluginSheetMusicList': strictStub('usePluginSheetMusicList', {
            default: () => [requestState(), SHEET, musicList, noop],
        }),
        '@/pages/topListDetail/hooks/useTopListDetail': strictStub('useTopListDetail', {
            default: () => [musicList ? {...TOP_LIST, musicList} : null, requestState(), noop],
        }),
        '@shopify/flash-list': strictStub('@shopify/flash-list', {FlashList: FlashListGrid}),
        '@/core/trackPlayer': strictStub('@/core/trackPlayer', {
            default: {
                repeatMode: 'QUEUE',
                play: noop,
                playWithReplacePlayList: noop,
                addNext: noop,
                addPlayLater: noop,
            },
            // 正在放第一首：这一行高亮
            useCurrentMusic: () => SONGS[0],
        }),
        '@/core/pluginManager': strictStub('@/core/pluginManager', {
            default: {getByMedia: () => ({instance: {}})},
        }),
        '@/core/musicSheet': strictStub('@/core/musicSheet', {
            default: {
                defaultSheet: {id: 'favorite'},
                starMusicSheet: noop,
                unstarMusicSheet: noop,
                removeMusic: noop,
                removeSheet: noop,
                getSheetMeta: () => undefined,
                setSortType: noop,
            },
            useSheetIsStarred: () => false,
            useSheetItem: () => ({...LOCAL_SHEET, musicList: musicList ?? []}),
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
    loaderRef.current = loader;
    const Page = loader.load(PAGES[route].module).default;
    const rendered = renderLayout(inAppFontScaleScope(loader, {route}, h(Page)), {
        env,
        width: env.window.width,
        height: env.window.height,
    });
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

const rightOf = frame => frame.x + frame.width;
const bottomOf = frame => frame.y + frame.height;

function assertInside(record, area, what) {
    assert.ok(
        record.frame.x >= area.left - 0.5 && rightOf(record.frame) <= area.right + 0.5,
        `${what} ${describeFrame(record.frame)} stays between x=${area.left} and x=${area.right}`,
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

const byLabel = label => record => record.props.accessibilityLabel === label;

/** 标题栏里的标题（歌单页的封面下面还有一个同名的大标题） */
function navTitleOf(root, title) {
    return findOne(
        root,
        record => isText(record) && record.text === title && record.props.accessibilityRole !== 'header',
        'nav title',
    );
}

/** 标题栏：标题一行（可以截断），不压到返回、搜索、更多按钮；按钮都在安全区里 */
function assertAppBar(root, area, titleText) {
    assertReadable(titleText, 'nav title');
    assert.equal(titleText.textInfo.shownLines, 1);
    const [back, search, more] = ['back', 'magnifying-glass', 'ellipsis-vertical'].map(label =>
        findOne(root, byLabel(label), label),
    );
    for (const button of [back, search, more]) {
        assertInside(button, area, `app bar button ${button.props.accessibilityLabel}`);
    }
    assert.ok(rightOf(back.frame) <= titleText.frame.x + 0.5, 'title does not cover the back button');
    assert.ok(rightOf(titleText.frame) <= search.frame.x + 0.5, 'title does not cover the search button');
}

/**
 * 封面下面的标题、副标题、歌曲数和简介；播放、随机播放两个大按钮；收藏等小按钮。
 * @param {{title: string, subtitle?: string, secondary: string[]}} expected
 */
function assertHeader(root, area, t, expected) {
    const content = {left: area.left + PAGE_MARGIN, right: area.right - PAGE_MARGIN};
    const title = findOne(root, record => isText(record) && record.props.accessibilityRole === 'header', 'sheet title');
    assert.equal(title.text, expected.title);
    assertReadable(title, 'sheet title');
    assert.ok(title.textInfo.shownLines <= 2);
    assertInside(title, content, 'sheet title');
    for (const text of [expected.subtitle, t('sheetDetail.totalMusicCount', {count: expected.count})].filter(Boolean)) {
        const record = findOne(root, byText(text), text);
        assertReadable(record, text);
        assertInside(record, content, text);
        assert.ok(record.frame.y >= bottomOf(title.frame) - 0.5, `${text} is below the title`);
    }

    // 播放、随机播放：标签一行完整显示，按钮至少 44 高
    const mainButtons = ['playAllBar.play', 'playAllBar.shuffle'].map(key =>
        findOne(root, record => record.props.accessibilityRole === 'button' && record.props.accessibilityLabel === t(key), key),
    );
    for (const button of mainButtons) {
        const [label] = findAll(button, isText);
        assertReadable(label, `button ${label.text}`);
        assert.equal(label.textInfo.neededLines, 1, `${label.text} fits on one line`);
        assert.ok(contains(button.frame, label.frame, 1), `${label.text} stays in its button`);
        assert.ok(button.frame.height >= 44 - 0.5, `button ${label.text} is at least 44 dp tall`);
        assertInside(button, {left: area.left + 20, right: area.right - 20}, `button ${label.text}`);
    }
    assertNoOverlap(mainButtons, 'play buttons');

    // 收藏、加入歌单、批量编辑：放不下一行时折到下一行，不伸出页面
    const secondary = expected.secondary.map(key =>
        findOne(root, record => record.props.accessibilityRole === 'button' && record.props.accessibilityLabel === t(key), key),
    );
    for (const button of secondary) {
        const [label] = findAll(button, isText);
        assertReadable(label, `button ${label.text}`);
        assert.equal(label.textInfo.neededLines, 1, `${label.text} fits on one line`);
        assert.ok(contains(button.frame, label.frame, 1), `${label.text} stays in its button`);
        assertInside(button, {left: area.left + 20, right: area.right - 20}, `button ${label.text}`);
        assert.ok(button.frame.y >= bottomOf(mainButtons[0].frame) - 0.5, `${label.text} is below the play buttons`);
    }
    assertNoOverlap(secondary, 'secondary buttons');
}

/**
 * 歌曲行：至少 64 高、互不重叠；歌名、歌手专辑一行（可以截断）；音质角标、时长完整
 * 显示；行里的东西都不出行；更多按钮在安全区里。
 * @returns 每首歌的那一行
 */
function assertSongRows(root, area, t) {
    const rows = SONGS.map(song =>
        findOne(root, byLabel(`${song.title}, ${song.artist}`), `row ${song.title}`),
    );
    for (const [index, row] of rows.entries()) {
        const song = SONGS[index];
        assert.ok(row.frame.height >= 64 - 0.5, `row ${song.title} is at least 64 dp tall`);
        // 行占满安全区的宽度：左右的安全区只让开一次
        assert.ok(
            Math.abs(row.frame.x - area.left) <= 0.5 && Math.abs(rightOf(row.frame) - area.right) <= 0.5,
            `row ${song.title} ${describeFrame(row.frame)} spans the safe area x=${area.left}…${area.right}`,
        );
        const texts = findAll(row, isText);
        for (const text of texts) {
            assertReadable(text, `"${text.text}" in row ${song.title}`);
            assert.equal(text.textInfo.shownLines, 1, `"${text.text}" stays on one line`);
            assert.ok(contains(row.frame, text.frame, 1), `"${text.text}" stays in row ${song.title}`);
            assert.equal(clippingAncestor(text), null, `"${text.text}" is not clipped`);
        }
        const title = findOne(row, byText(song.title), 'song title');
        const details = texts.filter(text => text.frame.y >= bottomOf(title.frame) - 0.5);
        assert.ok(details.length >= 1, `row ${song.title} has its artist line below the title`);
        // 时长和音质角标完整显示
        const duration = texts.find(text => /^\d+(:\d{2}){1,2}$/.test(text.text));
        assert.ok(duration, `row ${song.title} shows its duration`);
        assert.ok(!duration.textInfo.truncated, `duration ${duration.text} is shown in full`);
        assert.ok(duration.frame.x >= rightOf(title.frame) - 0.5, 'duration is right of the title');
        const badge = texts.find(text => /^[A-Z+]{2}$/.test(text.text));
        assert.ok(badge, `row ${song.title} shows its quality badge`);
        assert.ok(!badge.textInfo.truncated);
        assert.ok(contains(badge.parent.frame, badge.frame, 1), `badge ${badge.text} fits its frame ${describeFrame(badge.parent.frame)}`);
        const more = findOne(row, byLabel(t('musicList.item.moreOptions.a11y', {title: song.title})), 'more button');
        assert.ok(more.frame.x >= rightOf(duration.frame) - 0.5, 'more button is right of the duration');
        // 「更多」的点击区域是整行的高度，加上左右的 hitSlop 至少 44 宽：点图标上下不会点到整行去播放
        const slop = more.props.hitSlop ?? {};
        assert.ok(
            Math.abs(more.frame.y - row.frame.y) <= 0.5 && Math.abs(more.frame.height - row.frame.height) <= 0.5,
            `more button ${describeFrame(more.frame)} spans row ${describeFrame(row.frame)}`,
        );
        assert.ok(more.frame.width + (slop.left ?? 0) + (slop.right ?? 0) >= 44 - 0.5, 'more button is at least 44 dp wide to touch');
    }
    assertNoOverlap(rows, 'song rows');
    return rows;
}

function assertEndOfList(root, rows, t, {footer: hasFooter = true} = {}) {
    if (hasFooter) {
        const footer = findOne(root, byText(t('common.listReachEnd')), 'end of list');
        assertReadable(footer, 'end of list');
    }
    let content = rows[rows.length - 1];
    while (content.type !== 'ScrollContent') {
        content = content.parent;
    }
    const lastBottom = Math.max(...rows.map(row => bottomOf(row.frame)));
    const spaceBelowLast = bottomOf(content.frame) - lastBottom;
    const {reservedBottom} = pageMusicBarLayout();
    assert.ok(
        spaceBelowLast >= reservedBottom - 0.5,
        `only ${spaceBelowLast.toFixed(1)} dp below the last song; the mini player needs ${reservedBottom}`,
    );
}

for (const device of DEVICES) {
    for (const language of LANGUAGES) {
        for (const fontScale of FONT_SCALES) {
            const where = `${device.name}, ${language}, font scale ${fontScale}`;

            test(`plugin sheet detail on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, fontSizes} = renderDetail(env, 'plugin-sheet-detail');
                const area = safeArea(device);
                try {
                    const navTitle = navTitleOf(root, SHEET.title);
                    assert.equal(navTitle.metrics.fontSize, fontSizes.appbar * fontScale, 'the page follows the system font');
                    assertAppBar(root, area, navTitle);
                    assertHeader(root, area, t, {
                        title: SHEET.title,
                        subtitle: SHEET.artist,
                        count: SHEET.worksNum,
                        secondary: ['playAllBar.favorite', 'playAllBar.addToSheet', 'playAllBar.batchEdit'],
                    });
                    const rows = assertSongRows(root, area, t);
                    assertEndOfList(root, rows, t);
                } finally {
                    unmount();
                }
            });

            test(`chart detail on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, fontSizes} = renderDetail(env, 'top-list-detail');
                const area = safeArea(device);
                try {
                    const navTitle = navTitleOf(root, t('topList.title'));
                    assert.equal(navTitle.metrics.fontSize, fontSizes.appbar * fontScale, 'the page follows the system font');
                    assertAppBar(root, area, navTitle);
                    assertHeader(root, area, t, {
                        title: TOP_LIST.title,
                        count: SONGS.length,
                        secondary: ['playAllBar.addToSheet', 'playAllBar.batchEdit'],
                    });
                    const rows = assertSongRows(root, area, t);
                    assertEndOfList(root, rows, t);
                } finally {
                    unmount();
                }
            });

            test(`album detail on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, fontSizes} = renderDetail(env, 'album-detail');
                const area = safeArea(device);
                try {
                    const navTitle = navTitleOf(root, t('common.album'));
                    assert.equal(navTitle.metrics.fontSize, fontSizes.appbar * fontScale, 'the page follows the system font');
                    assertAppBar(root, area, navTitle);
                    assertHeader(root, area, t, {
                        title: ALBUM.title,
                        subtitle: ALBUM.artist,
                        count: ALBUM.worksNum,
                        secondary: ['playAllBar.addToSheet', 'playAllBar.batchEdit'],
                    });
                    const rows = assertSongRows(root, area, t);
                    assertEndOfList(root, rows, t);
                } finally {
                    unmount();
                }
            });

            test(`local playlist detail on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, fontSizes} = renderDetail(env, 'local-sheet-detail');
                const area = safeArea(device);
                try {
                    const navTitle = navTitleOf(root, t('common.sheet'));
                    assert.equal(navTitle.metrics.fontSize, fontSizes.appbar * fontScale, 'the page follows the system font');
                    assertAppBar(root, area, navTitle);
                    assertHeader(root, area, t, {
                        title: LOCAL_SHEET.title,
                        count: SONGS.length,
                        secondary: ['playAllBar.addToSheet', 'playAllBar.batchEdit'],
                    });
                    const rows = assertSongRows(root, area, t);
                    assertEndOfList(root, rows, t, {footer: false});
                } finally {
                    unmount();
                }
            });

            test(`local playlist detail in selection mode on ${where}`, () => {
                // 自己的歌单多选时还能删除：底部操作栏是 5 格
                const env = createEnv({...device, language, fontScale});
                const rendered = renderDetail(env, 'local-sheet-detail');
                const {t, fontSizes} = rendered;
                const area = safeArea(device);
                try {
                    const firstRow = findOne(rendered.root, byLabel(`${SONGS[0].title}, ${SONGS[0].artist}`), 'first row');
                    const root = rendered.interact(() => firstRow.props.onLongPress());
                    const bar = findOne(root, byLabel(t('musicListEditor.addToNextPlay')), 'play next').parent;
                    const actions = [
                        'musicListEditor.addToNextPlay',
                        'playLater.add',
                        'musicListEditor.addToSheet',
                        'common.download',
                        'common.delete',
                    ].map(key => findOne(bar, byLabel(t(key)), key));
                    assertInside(bar, area, 'selection bar');
                    for (const action of actions) {
                        const [label] = findAll(action, isText);
                        assert.ok(label.metrics.fontSize <= fontSizes.subTitle * 1.5 + 0.01, `action ${label.text} is capped at 1.5x`);
                        assertReadable(label, `action ${label.text}`);
                        assert.ok(contains(action.frame, label.frame, 1), `action ${label.text} stays in its cell`);
                        assert.ok(contains(bar.frame, action.frame, 0.5), `action ${label.text} stays in the bar`);
                    }
                    assertNoOverlap(actions, 'selection actions');
                } finally {
                    rendered.unmount();
                }
            });

            test(`plugin sheet detail in selection mode on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const rendered = renderDetail(env, 'plugin-sheet-detail');
                const {t, fontSizes} = rendered;
                const area = safeArea(device);
                try {
                    // 长按第一首进入多选
                    const firstRow = findOne(rendered.root, byLabel(`${SONGS[0].title}, ${SONGS[0].artist}`), 'first row');
                    const root = rendered.interact(() => firstRow.props.onLongPress());

                    // 列表顶上：已选几首、全选、取消
                    const count = findOne(root, byText(t('musicList.selection.selectedCount', {count: 1})), 'selected count');
                    const headerButtons = ['common.selectAll', 'common.cancel'].map(key =>
                        findOne(root, record => record.props.accessibilityRole === 'button' && record.props.accessibilityLabel === t(key), key),
                    );
                    for (const text of [count, ...headerButtons.map(button => findAll(button, isText)[0])]) {
                        assertReadable(text, `"${text.text}"`);
                        assert.equal(text.textInfo.shownLines, 1);
                        assert.ok(!text.textInfo.truncated, `"${text.text}" is shown in full`);
                        assertInside(text, area, `"${text.text}"`);
                        assert.equal(clippingAncestor(text), null, `"${text.text}" is not clipped`);
                    }
                    assertNoOverlap([count, ...headerButtons], 'selection header');

                    // 底部操作栏：每个操作的图标和名字都在自己那一格里，整栏在安全区里。
                    // 「加入歌单」和播放按钮区里的重名，在操作栏里找
                    const bar = findOne(root, byLabel(t('musicListEditor.addToNextPlay')), 'play next').parent;
                    const actions = [
                        'musicListEditor.addToNextPlay',
                        'playLater.add',
                        'musicListEditor.addToSheet',
                        'common.download',
                    ].map(key => findOne(bar, byLabel(t(key)), key));
                    assertInside(bar, area, 'selection bar');
                    assert.ok(bottomOf(bar.frame) <= area.bottom + 0.5, 'selection bar is above the bottom inset');
                    for (const action of actions) {
                        const [label] = findAll(action, isText);
                        // 操作栏高度固定、格子等宽：名字和其他尺寸固定的紧凑控件一样封顶 1.5 倍
                        assert.ok(label.metrics.fontSize <= fontSizes.subTitle * 1.5 + 0.01, `action ${label.text} is capped at 1.5x`);
                        assertReadable(label, `action ${label.text}`);
                        assert.ok(contains(action.frame, label.frame, 1), `action ${label.text} ${describeFrame(label.frame)} stays in ${describeFrame(action.frame)}`);
                        assert.ok(contains(bar.frame, action.frame, 0.5), `action ${label.text} stays in the bar`);
                        assert.equal(clippingAncestor(label), null);
                    }
                    assertNoOverlap(actions, 'selection actions');

                    // 滚到底时最后一首露在操作栏上面：列表底部的留空跟着操作栏的实际高度
                    const lastRow = findOne(root, byLabel(`${SONGS[SONGS.length - 1].title}, ${SONGS[SONGS.length - 1].artist}`), 'last row');
                    let content = lastRow;
                    while (content.type !== 'ScrollContent') {
                        content = content.parent;
                    }
                    const viewportBottom = bottomOf(content.parent.frame);
                    const spaceBelowLast = bottomOf(content.frame) - bottomOf(lastRow.frame);
                    assert.ok(
                        spaceBelowLast >= viewportBottom - bar.frame.y - 0.5,
                        `only ${spaceBelowLast.toFixed(1)} dp below the last song; the selection bar covers ${(viewportBottom - bar.frame.y).toFixed(1)}`,
                    );
                } finally {
                    rendered.unmount();
                }
            });

            test(`plugin sheet detail while loading and after an error, ${where}`, () => {
                const area = safeArea(device);
                const env = createEnv({...device, language, fontScale});
                const loading = renderDetail(env, 'plugin-sheet-detail', {state: 'PENDING_FIRST_PAGE', musicList: null});
                try {
                    const text = findOne(loading.root, byText(loading.t('common.loading')), 'loading');
                    assertReadable(text, 'loading');
                    assertInside(text, area, 'loading');
                } finally {
                    loading.unmount();
                }
                const failed = renderDetail(env, 'plugin-sheet-detail', {state: 'ERROR', musicList: []});
                try {
                    for (const key of ['common.error', 'common.clickToRetry']) {
                        const text = findOne(failed.root, byText(failed.t(key)), key);
                        assertReadable(text, key);
                        assertInside(text, area, key);
                        assert.equal(clippingAncestor(text), null, `${key} is not clipped`);
                    }
                } finally {
                    failed.unmount();
                }
            });
        }
    }
}

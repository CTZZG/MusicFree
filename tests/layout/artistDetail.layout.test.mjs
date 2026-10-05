// 歌手详情（搜索结果、歌曲的「更多」里点歌手进来）：标题栏、头像和名字、粉丝数、简介，
// 单曲、专辑两个标签和下面的列表。按 1、1.3、1.5、2 倍系统字体排版：文字不被裁掉、
// 不挤成一条缝，头部不压到标签，控件都在安全区里；滚到底时最后一项露在迷你播放器上面。
// 横屏时头部在左边一栏，标签和列表在右边。
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
    isText,
    renderLayout,
    strictStub,
} from './harness.mjs';
import {
    FlashListGrid,
    createEnv,
    createPageStubs,
    createTabViewStub,
    inAppFontScaleScope,
    pageMusicBarLayout,
} from './stubs.mjs';

const h = React.createElement;
const require = createRequire(import.meta.url);
// 结果放在 jotai 的 atom 里：用真的 jotai，每次渲染一个自己的 store
const jotai = require('jotai');

const FONT_SCALES = [1, 1.3, 1.5, 2];
const LANGUAGES = ['zh-CN', 'en-US'];

const ARTISTS = {
    full: {
        id: 'jay',
        platform: '网易云',
        name: '周杰伦',
        avatar: 'jay',
        fans: 12345678,
        description:
            '华语流行乐男歌手、音乐人、演员、导演。2000 年发行首张个人专辑《Jay》，融合 R&B、嘻哈、中国风等多种音乐风格，代表作有《晴天》《七里香》《稻香》。',
    },
    // 名字特别长，没有粉丝数和简介
    long: {
        id: 'band',
        platform: '一个名字特别长的自建音源',
        name: 'The Very Long Band Name 一个名字特别长的乐队',
    },
};

const makeSong = (id, title, extra = {}) => ({
    id,
    title,
    artist: '周杰伦',
    album: '叶惠美',
    platform: '网易云',
    duration: 245,
    ...extra,
});
const SONGS = [
    makeSong('1', '晴天'),
    makeSong('2', '一首名字特别特别长的中文歌曲（现场版）', {album: '2004 无与伦比演唱会 Live'}),
    makeSong('3', 'Whatever Happens in a Very Long Song Title', {album: 'Invincible'}),
    makeSong('4', '稻香', {album: ''}),
    makeSong('5', '最后一首歌'),
];

const ALBUMS = [
    {id: 'a1', platform: '网易云', title: '叶惠美', artist: '周杰伦', date: '2003-07-31', artwork: 'a1'},
    {id: 'a2', platform: '网易云', title: '2004 无与伦比演唱会 Live（豪华版）', artist: '周杰伦', date: '2004-12-30', artwork: 'a2'},
    {id: 'a3', platform: '网易云', title: 'Jay Chou’s Bedtime Stories', artist: '周杰伦', artwork: 'a3'},
];

const DEVICES = [
    {name: '320×640', width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {name: "the user's phone 363×806", width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
    {name: 'landscape 806×363', width: 806, height: 363, scale: 3.5, insets: {top: 0, right: 24, bottom: 20, left: 24}},
];

function noop() {}

function renderArtist(env, artistItem) {
    const loader = createModuleLoader({
        ...createPageStubs(env, {params: {pluginHash: 'p', artistItem}}),
        jotai,
        // 结果由测试直接放进 atom，不发请求
        '@/pages/artistDetail/hooks/useQuery': strictStub('useQueryArtist', {default: () => noop}),
        'react-native-tab-view': createTabViewStub(),
        '@shopify/flash-list': strictStub('@shopify/flash-list', {FlashList: FlashListGrid}),
        '@/components/dialogs/useDialog': strictStub('useDialog', {showDialog: noop}),
        '@/core/trackPlayer': strictStub('@/core/trackPlayer', {
            default: {play: noop, addNext: noop, addPlayLater: noop},
        }),
        '@/core/pluginManager': strictStub('@/core/pluginManager', {
            default: {getByHash: () => null, getByMedia: () => ({instance: {}})},
        }),
        '@/core/musicSheet': strictStub('@/core/musicSheet', {default: {defaultSheet: {id: 'favorite'}}}),
        '@/core/localMusicSheet': strictStub('@/core/localMusicSheet', {
            default: {useLocalFileExists: () => undefined, useLocalMusic: () => null},
        }),
        // 只在下载中、下载过的歌曲上显示，这里的歌都没下载
        '@/components/downloadStatusIndicator': strictStub('downloadStatusIndicator', {default: () => null}),
        '@/utils/mediaExtra': strictStub('@/utils/mediaExtra', {useMediaExtraProperty: () => undefined}),
        '@/hooks/useLocalMusicArtwork': strictStub('useLocalMusicArtwork', {default: ({artwork}) => artwork}),
    });
    const {RequestStateCode} = loader.load('@/constants/commonConst');
    const {queryResultAtom} = loader.load('@/pages/artistDetail/store/atoms');
    const store = jotai.createStore();
    store.set(queryResultAtom, {
        music: {state: RequestStateCode.FINISHED, page: 1, data: SONGS},
        album: {state: RequestStateCode.FINISHED, page: 1, data: ALBUMS},
    });
    const ArtistDetail = loader.load('@/pages/artistDetail').default;
    const rendered = renderLayout(
        h(jotai.Provider, {store}, inAppFontScaleScope(loader, {route: 'artist-detail'}, h(ArtistDetail))),
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

const rightOf = frame => frame.x + frame.width;
const bottomOf = frame => frame.y + frame.height;
const byLabel = label => record => record.props.accessibilityLabel === label;

/** 文字的宽度按像素向上取整，比较文字时容差 1 dp */
function assertInside(record, bounds, what) {
    const tolerance = isText(record) ? 1 : 0.5;
    assert.ok(
        record.frame.x >= bounds.left - tolerance && rightOf(record.frame) <= bounds.right + tolerance,
        `${what} ${describeFrame(record.frame)} stays between x=${bounds.left} and x=${bounds.right}`,
    );
}

/** 文字框按像素向上取整：两段文字之间容差 1 dp */
function assertNoOverlap(records, what) {
    for (let i = 0; i < records.length; i++) {
        for (const other of records.slice(i + 1)) {
            const a = records[i].frame;
            const b = other.frame;
            const tolerance = isText(records[i]) && isText(other) ? 1 : 0.5;
            const overlapX = Math.min(rightOf(a), rightOf(b)) - Math.max(a.x, b.x);
            const overlapY = Math.min(bottomOf(a), bottomOf(b)) - Math.max(a.y, b.y);
            assert.ok(overlapX <= tolerance || overlapY <= tolerance, `${what}: ${describeFrame(a)} and ${describeFrame(b)} overlap`);
        }
    }
}

/**
 * 标题栏、头部（头像、名字和来源、粉丝数、简介）和两个标签。
 * @returns {{tabs: object[], header: object[]}} 标签和头部的文字
 */
function assertChrome(root, device, t, fontSizes, artist) {
    const area = safeArea(device);
    // 标题栏：这一页跟随系统字体；返回、菜单按钮在安全区里，标题不压到它们
    const navTitle = findOne(root, byText(t('common.artist')), 'nav title');
    assert.equal(navTitle.metrics.fontSize, fontSizes.appbar * fontScaleOf(device, navTitle), 'the page follows the system font');
    assertReadable(navTitle, 'nav title');
    const back = findOne(root, byLabel('back'), 'back');
    const menu = findOne(root, byLabel('ellipsis-vertical'), 'menu');
    for (const button of [back, menu]) {
        assertInside(button, area, `app bar button ${button.props.accessibilityLabel}`);
    }
    assert.ok(rightOf(back.frame) <= navTitle.frame.x + 0.5, 'title does not cover the back button');
    assert.ok(rightOf(navTitle.frame) <= menu.frame.x + 0.5, 'title does not cover the menu button');

    // 头部：名字一行（太长截断），来源角标完整显示；粉丝数、简介（最多两行）不被裁
    // 列表里的行也会出现歌手名、来源和封面，只在头部找
    const inHeader = predicate => record => predicate(record) && !insideRow(record);
    const avatar = findOne(root, inHeader(record => record.type === 'Image'), 'avatar');
    const name = findOne(root, inHeader(byText(artist.name)), 'artist name');
    const tag = findOne(root, inHeader(byText(artist.platform)), 'platform tag');
    const header = [name, tag];
    if (artist.fans) {
        header.push(findOne(root, byText(t('artistDetail.fansCount', {count: artist.fans})), 'fans'));
    }
    if (artist.description) {
        const description = findOne(root, byText(artist.description), 'description');
        assert.ok(description.textInfo.shownLines <= 2, 'description takes at most two lines');
        header.push(description);
    }
    for (const text of header) {
        assertReadable(text, `"${text.text}"`);
        assertInside(text, area, `"${text.text}"`);
        assert.equal(clippingAncestor(text), null, `"${text.text}" is not clipped`);
        assert.ok(text.frame.y >= bottomOf(navTitle.parent.frame) - 0.5, `"${text.text}" is below the app bar`);
    }
    assert.equal(name.textInfo.shownLines, 1, 'the name stays on one line');
    // 名字、粉丝数在头像那一行里：行跟着内容变高，不伸到简介上
    const avatarRow = avatar.parent;
    for (const text of header) {
        if (text === tag || text.text === artist.description) {
            continue;
        }
        assert.ok(
            contains(avatarRow.frame, text.frame, 1),
            `"${text.text}" ${describeFrame(text.frame)} stays in the avatar row ${describeFrame(avatarRow.frame)}`,
        );
    }
    assert.ok(!tag.textInfo.truncated || artist.platform.length > 8, `tag ${artist.platform} is shown in full`);
    assert.ok(contains(tag.parent.frame, tag.frame, 1), 'the tag text fits its frame');
    assert.ok(tag.parent.frame.x >= rightOf(name.frame) - 0.5, 'the tag is right of the name');
    assert.ok(avatar.frame.x >= area.left - 0.5, 'avatar is inside the safe area');
    assert.ok(rightOf(avatar.frame) <= name.frame.x + 0.5, 'the name is right of the avatar');
    assertNoOverlap([avatar, ...header.filter(text => text !== tag)], 'header');

    // 两个标签：至少 48 高，名字完整显示，选中、未选中两份一样；窄屏、大字体时第二个
    // 标签可以滑过去（clippingAncestor 按标签栏能不能滚动来判断）
    // 按界面语言朗读（以前读的是路由里写死的中文 title）
    const tabs = [t('common.singleMusic'), t('common.album')].map(label => findOne(root, record => record.props.accessibilityRole === 'tab' && record.props.accessibilityLabel === label, `tab ${label}`));
    assert.ok(tabs[0].frame.x >= area.left - 0.5, 'the tabs start inside the safe area');
    for (const [index, tab] of tabs.entries()) {
        const title = t(index === 0 ? 'common.singleMusic' : 'common.album');
        assert.ok(tab.frame.height >= 48 - 0.5, `tab ${title} ${describeFrame(tab.frame)} is at least 48 dp tall`);
        const labels = findAll(tab, isText);
        assert.equal(labels.length, 2, 'unfocused and focused copies of the label');
        for (const label of labels) {
            assert.equal(label.text, title);
            assertReadable(label, `tab ${title}`);
            assert.ok(!label.textInfo.truncated, `tab ${title} is shown in full`);
            assert.ok(contains(tab.frame, label.frame, 1), `tab ${title} label stays in its tab`);
            assert.equal(clippingAncestor(label), null, `tab ${title} is not cut off`);
        }
    }
    assertNoOverlap(tabs, 'tabs');
    // 竖屏时头部在标签上面，横屏时在左边
    const portrait = device.width < device.height;
    for (const text of [avatar, ...header]) {
        if (portrait) {
            assert.ok(bottomOf(text.frame) <= tabs[0].frame.y + 1, `"${text.text ?? 'avatar'}" ${describeFrame(text.frame)} is above the tabs`);
        } else {
            assert.ok(rightOf(text.frame) <= tabs[0].frame.x + 1, `"${text.text ?? 'avatar'}" ${describeFrame(text.frame)} is left of the tabs`);
        }
    }
    return {tabs, header};
}

function insideRow(record) {
    for (let ancestor = record.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.props.accessibilityRole === 'button') {
            return true;
        }
    }
    return false;
}

/** 系统字体缩放（测试按设备的 fontScale 渲染） */
function fontScaleOf(device, text) {
    return text.metrics.fontSize / 17;
}

/** 列表行：至少 64 高、互不重叠、在标签下面；行里的文字一行，不出行、不被裁 */
function assertRows(rows, tabs, area, what) {
    const tabsBottom = Math.max(...tabs.map(tab => bottomOf(tab.frame)));
    for (const row of rows) {
        const name = row.props.accessibilityLabel;
        assert.ok(row.frame.height >= 64 - 0.5, `${what} row ${name} ${describeFrame(row.frame)} is at least 64 dp tall`);
        assert.ok(row.frame.y >= tabsBottom - 0.5, `${what} row ${name} is below the tabs`);
        assertInside(row, area, `${what} row ${name}`);
        for (const text of findAll(row, isText)) {
            assertReadable(text, `"${text.text}" in ${what} row ${name}`);
            assert.equal(text.textInfo.shownLines, 1, `"${text.text}" stays on one line`);
            assert.ok(contains(row.frame, text.frame, 1), `"${text.text}" stays in ${what} row ${name}`);
            assert.equal(clippingAncestor(text), null, `"${text.text}" is not clipped`);
        }
    }
    assertNoOverlap(rows, `${what} rows`);
    // 滚到底时最后一行露在迷你播放器上面
    let content = rows[rows.length - 1];
    while (content.type !== 'ScrollContent') {
        content = content.parent;
    }
    const spaceBelowLast = bottomOf(content.frame) - Math.max(...rows.map(row => bottomOf(row.frame)));
    const {reservedBottom} = pageMusicBarLayout();
    assert.ok(
        spaceBelowLast >= reservedBottom - 0.5,
        `only ${spaceBelowLast.toFixed(1)} dp below the last ${what}; the mini player needs ${reservedBottom}`,
    );
}

for (const device of DEVICES) {
    for (const language of LANGUAGES) {
        for (const fontScale of FONT_SCALES) {
            const where = `${device.name}, ${language}, font scale ${fontScale}`;

            for (const [kind, artist] of Object.entries(ARTISTS)) {
                test(`artist detail (${kind}) with songs on ${where}`, () => {
                    const env = createEnv({...device, language, fontScale});
                    const {root, unmount, t, fontSizes} = renderArtist(env, artist);
                    const area = safeArea(device);
                    try {
                        const {tabs} = assertChrome(root, device, t, fontSizes, artist);
                        assert.equal(fontScaleOf(device, findOne(root, byText(t('common.artist')), 'nav title')), fontScale);
                        const rows = SONGS.map(song => findOne(root, byLabel(`${song.title}, ${song.artist}`), `row ${song.title}`));
                        assertRows(rows, tabs, area, 'song');
                        for (const [index, row] of rows.entries()) {
                            const song = SONGS[index];
                            const more = findOne(row, byLabel(t('musicList.item.moreOptions.a11y', {title: song.title})), 'more button');
                            assert.ok(
                                Math.abs(more.frame.y - row.frame.y) <= 0.5 && Math.abs(more.frame.height - row.frame.height) <= 0.5,
                                `more button ${describeFrame(more.frame)} spans row ${describeFrame(row.frame)}`,
                            );
                            const tag = findOne(row, byText(song.platform), `tag of ${song.title}`);
                            assert.ok(!tag.textInfo.truncated, `tag of ${song.title} is shown in full`);
                        }
                    } finally {
                        unmount();
                    }
                });
            }

            test(`artist detail albums on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const rendered = renderArtist(env, ARTISTS.full);
                const {t, fontSizes} = rendered;
                const area = safeArea(device);
                try {
                    const albumTab = findOne(rendered.root, record => record.props.accessibilityRole === 'tab' && record.props.accessibilityLabel === t('common.album'), 'album tab');
                    const root = rendered.interact(() => albumTab.props.onPress());
                    const {tabs} = assertChrome(root, device, t, fontSizes, ARTISTS.full);
                    const rows = ALBUMS.map(album => {
                        let row = findOne(root, byText(album.title), `album ${album.title}`);
                        while (row.props.accessibilityRole !== 'button') {
                            row = row.parent;
                        }
                        return row;
                    });
                    assertRows(rows, tabs, area, 'album');
                } finally {
                    rendered.unmount();
                }
            });
        }
    }
}

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    byTestID,
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
import {createCommonStubs, createEnv, homeTabMusicBarLayout, inAppFontScaleScope} from './stubs.mjs';

const h = React.createElement;
const SHEETS = [
    {id: 'one', title: '通勤时听的华语经典与长长的演唱会歌单', worksNum: 120, artwork: 'one'},
    {id: 'favorite', title: 'Favorite', worksNum: 12},
    {id: 'two', title: 'Late Night Music for Relaxing and Studying', worksNum: 35, artwork: 'two'},
    {id: 'three', title: '纯音乐', worksNum: 8},
    {id: 'four', title: 'Jazz', worksNum: 6},
];
// 自己的歌单在「我的歌单」里；「我喜欢」在上面的入口里
const USER_SHEETS = SHEETS.filter(sheet => sheet.id !== 'favorite');

const DEVICES = [
    {width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
    {width: 800, height: 363, scale: 3.5, insets: {top: 0, right: 24, bottom: 20, left: 24}},
];

const rightOf = frame => frame.x + frame.width;
const bottomOf = frame => frame.y + frame.height;
const byLabel = label => record => record.props.accessibilityLabel === label;

/** 点得到的范围：按钮本身加上 hitSlop */
function touchFrame(button) {
    const slop = button.props.hitSlop ?? {};
    const left = slop.left ?? 0;
    const top = slop.top ?? 0;
    return {
        x: button.frame.x - left,
        y: button.frame.y - top,
        width: button.frame.width + left + (slop.right ?? 0),
        height: button.frame.height + top + (slop.bottom ?? 0),
    };
}

function overlaps(a, b, tolerance = 0.5) {
    const overlapX = Math.min(rightOf(a), rightOf(b)) - Math.max(a.x, b.x);
    const overlapY = Math.min(bottomOf(a), bottomOf(b)) - Math.max(a.y, b.y);
    return overlapX > tolerance && overlapY > tolerance;
}

function renderLibrary(env, sheets = SHEETS) {
    // 首页正在播放、标签栏显示时底部两栏的位置
    const musicBarLayout = homeTabMusicBarLayout();
    const stubs = {
        ...createCommonStubs(env),
        '@react-navigation/native': strictStub('navigation', {useScrollToTop() {}}),
        '@/components/base/statusBar': strictStub('statusBar', {default: () => null}),
        // 真实的 useMusicBarFloatingOffset 读这份布局状态
        '@/components/musicBar/layoutState': strictStub('musicBarLayoutState', {
            useMusicBarLayoutState: () => ({layout: musicBarLayout}),
        }),
        '@/components/dialogs/useDialog': strictStub('dialogs', {showDialog() {}}),
        '@/core/downloader': strictStub('downloader', {useDownloadQueue: () => []}),
        '@/core/musicSheet': strictStub('musicSheet', {
            default: {defaultSheet: {id: 'favorite'}},
            useSheetsBase: () => sheets,
            useStarredSheets: () => [],
        }),
    };
    const loader = createModuleLoader(stubs);
    const Library = loader.load('@/pages/library').default;
    return {
        // 资料库是主页的一个标签，字体缩放跟着标签的登记
        ...renderLayout(inAppFontScaleScope(loader, {homeTab: 'library-tab'}, h(Library)), {
            env,
            width: env.window.width,
            height: env.window.height,
        }),
        t: loader.load('@/core/i18n').default.t,
        musicBarLayout,
    };
}

/** 上面入口卡片里的「我喜欢」：和其他入口一样一行，右边写歌数，点开是「我喜欢」歌单 */
function assertFavoriteEntry(root, t, count, device) {
    const title = t('home.favoriteSheet');
    const label = count ? `${title}，${t('home.songCount', {count})}` : title;
    const entry = findOne(root, record => record.props.accessibilityLabel === label && typeof record.props.onPress === 'function', 'favorite entry');
    const localMusic = findOne(root, record => record.props.accessibilityLabel === t('home.localMusic'), 'local music entry');
    assert.ok(Math.abs(entry.frame.x - localMusic.frame.x) <= 0.5 && Math.abs(entry.frame.width - localMusic.frame.width) <= 0.5,
        `favorite entry ${describeFrame(entry.frame)} is a row of the same card as local music ${describeFrame(localMusic.frame)}`);
    assert.ok(entry.frame.height <= localMusic.frame.height + 0.5, 'favorite entry is as compact as the other entries');
    assert.ok(entry.frame.x >= device.insets.left + 16 - 0.5 && rightOf(entry.frame) <= device.width - device.insets.right - 16 + 0.5);
    for (const text of findAll(entry, isText)) {
        assert.ok(!text.textInfo.clippedVertically, `${text.text} is tall enough`);
        assert.ok(!text.textInfo.truncated, `${text.text} is shown in full`);
        assert.ok(contains(entry.frame, text.frame, 1));
    }
    const value = findAll(entry, byText(String(count)));
    assert.equal(value.length, count ? 1 : 0, count ? 'favorite entry shows its song count' : 'an empty favorite shows no count');
    assert.equal(clippingAncestor(entry), null, 'favorite entry is not clipped');
    return entry;
}

for (const device of DEVICES) {
    for (const mode of ['grid', 'list']) {
        for (const language of ['zh-CN', 'en-US']) {
            for (const fontScale of [1, 2]) {
                test(`library ${mode}, ${device.width} dp, ${language}, font scale ${fontScale}`, () => {
                    const env = createEnv({...device, language, fontScale, config: {'library.playlistView': mode}});
                    const {root, unmount, t, musicBarLayout} = renderLibrary(env);
                    try {
                        assertFavoriteEntry(root, t, 12, device);
                        const container = findOne(root, byTestID(`library-playlist-${mode}`), 'playlists');
                        const items = findAll(container, record => typeof record.props.onLongPress === 'function');
                        assert.deepEqual(
                            items.map(item => item.props.accessibilityLabel.split('，')[0]),
                            USER_SHEETS.map(sheet => sheet.title),
                            'my playlists lists only the user\'s own playlists',
                        );
                        const left = device.insets.left + 16;
                        const right = device.width - device.insets.right - 16;
                        let previousBottom = -Infinity;
                        const touchAreas = [];
                        for (const [index, item] of items.entries()) {
                            const sheet = USER_SHEETS[index];
                            assert.ok(item.frame.x >= left - 0.5);
                            assert.ok(item.frame.x + item.frame.width <= right + 0.5);
                            assert.equal(clippingAncestor(item), null, 'playlist is not clipped');
                            const texts = findAll(item, isText);
                            for (const text of texts) {
                                assert.ok(!text.textInfo.clippedVertically, `text ${text.text} has sufficient height`);
                                assert.ok(!text.textInfo.squeezed, `text ${text.text} has room`);
                                assert.equal(clippingAncestor(text), null);
                                assert.ok(contains(item.frame, text.frame, 1));
                            }
                            // ⋮：不带底色，不压在名字、数量和封面上，点得到的范围至少 44 见方
                            const manage = findOne(root, byLabel(t('library.managePlaylist', {name: sheet.title})), `manage ${sheet.title}`);
                            const style = flattenStyle(manage.props.style);
                            assert.ok(!style.backgroundColor || style.backgroundColor === 'transparent', `manage button of ${sheet.title} has no background`);
                            const icon = findOne(manage, record => record.props.name === 'ellipsis-vertical', 'ellipsis icon');
                            const touch = touchFrame(manage);
                            assert.ok(touch.width >= 44 - 0.5 && touch.height >= 44 - 0.5, `manage button touch area ${describeFrame(touch)} is at least 44 dp`);
                            assert.ok(touch.x >= device.insets.left - 0.5 && rightOf(touch) <= device.width - device.insets.right + 0.5, 'manage button stays on screen');
                            for (const text of texts) {
                                assert.ok(!overlaps(manage.frame, text.frame), `manage button ${describeFrame(manage.frame)} does not cover "${text.text}" ${describeFrame(text.frame)}`);
                            }
                            const cover = item.children[0];
                            assert.ok(!overlaps(manage.frame, cover.frame), `manage button does not cover the artwork of ${sheet.title}`);
                            if (mode === 'list') {
                                assert.ok(Math.abs(item.frame.width - (right - left)) <= 0.5);
                                assert.ok(item.frame.height >= 64 - 0.5);
                                assert.ok(item.frame.y >= previousBottom - 0.5, 'rows do not overlap');
                                previousBottom = item.frame.y + item.frame.height;
                                // 整行那么高，点 ⋮ 上下不会点到整行去打开歌单；行里不再另放箭头
                                assert.ok(
                                    Math.abs(manage.frame.y - item.frame.y) <= 0.5 && Math.abs(manage.frame.height - item.frame.height) <= 0.5,
                                    `manage button ${describeFrame(manage.frame)} spans row ${describeFrame(item.frame)}`,
                                );
                                assert.equal(findAll(item, record => record.props.name === 'chevron-right').length, 0, 'rows have no chevron next to ⋮');
                                // ⋮ 画在页边距以内，和「编辑」右边对齐的那一列（和歌曲行的 ⋮ 差不多位置）
                                assert.ok(icon.frame.x >= item.frame.x && rightOf(icon.frame) <= right + 0.5, `ellipsis ${describeFrame(icon.frame)} stays inside the page margin`);
                                const edit = findOne(root, byText(t('common.edit')), 'edit button');
                                assert.ok(Math.abs(rightOf(icon.frame) - rightOf(edit.frame)) <= 4, `ellipsis ${describeFrame(icon.frame)} lines up with edit ${describeFrame(edit.frame)}`);
                            } else {
                                // 网格：在封面下面、名字右边，不伸进旁边那一格
                                const title = findOne(item, byText(sheet.title), 'tile title');
                                assert.ok(manage.frame.y >= bottomOf(cover.frame) - 0.5, 'manage button is below the artwork');
                                assert.ok(manage.frame.y <= title.frame.y + 0.5 && bottomOf(manage.frame) >= bottomOf(title.frame) - 0.5, 'manage button sits beside the title');
                                assert.ok(touch.x >= item.frame.x - 0.5, 'manage button touch area stays in its own tile');
                                assert.ok(contains(item.frame, icon.frame, 1), `ellipsis ${describeFrame(icon.frame)} is drawn inside tile ${describeFrame(item.frame)}`);
                                touchAreas.push({item, touch});
                            }
                        }
                        for (const {item, touch} of touchAreas) {
                            for (const other of items) {
                                if (other !== item) {
                                    assert.ok(!overlaps(touch, other.frame), `manage touch area ${describeFrame(touch)} reaches into tile ${describeFrame(other.frame)}`);
                                }
                            }
                        }
                        // 滚到底时最后一个歌单要露在底部两栏（和系统安全区）上面
                        let content = container.parent;
                        while (content.type !== 'ScrollContent') {
                            content = content.parent;
                        }
                        const last = items[items.length - 1].frame;
                        const spaceBelowLast = content.frame.y + content.frame.height - (last.y + last.height);
                        assert.ok(
                            spaceBelowLast >= device.insets.bottom + musicBarLayout.reservedBottom - 0.5,
                            `only ${spaceBelowLast.toFixed(1)} dp below the last playlist; the bars need ${device.insets.bottom + musicBarLayout.reservedBottom}`,
                        );
                        // 大标题右侧的三个操作按钮都必须留在安全区内。
                        const headerButtons = [
                            'home.importPlaylist.a11y',
                            'home.newPlaylist.a11y',
                            mode === 'list' ? 'library.switchToGrid' : 'library.switchToList',
                        ].map(key => findOne(root, record => record.props.accessibilityLabel === t(key), key));
                        for (const button of headerButtons) {
                            assert.ok(button.frame.x >= device.insets.left);
                            assert.ok(button.frame.x + button.frame.width <= device.width - device.insets.right);
                        }
                    } finally {
                        unmount();
                    }
                });
            }
        }
    }
}

for (const device of DEVICES) {
    for (const mode of ['grid', 'list']) {
        for (const language of ['zh-CN', 'en-US']) {
            test(`library saved pins/groups and filters, ${mode}, ${device.width} dp, ${language}, font scale 2`, () => {
                const env = createEnv({...device, language, fontScale: 2, config: {
                    'library.playlistView': mode,
                    'library.playlistOrganization': {
                        pinnedIds: ['two'],
                        groupBySheetId: {one: '通勤与放松', two: 'Late Night Music', three: '通勤与放松'},
                    },
                }});
                const rendered = renderLibrary(env);
                try {
                    let root = rendered.root;
                    const rows = tree => findAll(findOne(tree, byTestID(`library-playlist-${mode}`), 'playlists'), record => typeof record.props.onLongPress === 'function');
                    // 置顶的排最前；「我喜欢」不在这里
                    assert.ok(rows(root)[0].props.accessibilityLabel.startsWith(SHEETS.find(sheet => sheet.id === 'two').title));
                    assert.equal(rows(root).length, USER_SHEETS.length);
                    for (const text of findAll(root, isText)) {
                        assert.ok(!text.textInfo.clippedVertically, `${text.text} is tall enough`);
                        assert.equal(clippingAncestor(text), null, `${text.text} can be scrolled into view`);
                    }
                    // 置顶和分组那行字也不伸到 ⋮ 底下
                    for (const row of rows(root)) {
                        const name = row.props.accessibilityLabel.split('，')[0];
                        const manage = findOne(root, byLabel(rendered.t('library.managePlaylist', {name})), `manage ${name}`);
                        for (const text of findAll(row, isText)) {
                            assert.ok(!overlaps(manage.frame, text.frame), `manage button does not cover "${text.text}"`);
                        }
                    }
                    const manageButtons = findAll(root, record => record.props.accessibilityLabel?.startsWith(rendered.t('library.managePlaylist', {name: ''})));
                    assert.equal(manageButtons.length, USER_SHEETS.length);
                    const group = findOne(root, record => record.props.accessibilityLabel === '通勤与放松', 'group filter');
                    root = rendered.interact(() => group.props.onPress());
                    assert.equal(rows(root).length, 2);
                    const input = findOne(root, byTestID('library-playlist-search'), 'playlist name input');
                    root = rendered.interact(() => input.props.onChangeText('纯音乐'));
                    assert.equal(rows(root).length, 1);
                    root = rendered.interact(() => input.props.onChangeText('missing playlist'));
                    assert.equal(rows(root).length, 0);
                    const empty = findOne(root, record => record.text === rendered.t('library.noMatchingPlaylists'), 'empty search state');
                    assert.equal(clippingAncestor(empty), null);
                } finally {
                    rendered.unmount();
                }
            });
        }
    }
}

// 新装的应用只有一个空的「我喜欢」：「我的歌单」下面直接给新建和导入，不再是空列表
for (const device of DEVICES) {
    for (const language of ['zh-CN', 'en-US']) {
        for (const fontScale of [1, 2]) {
            test(`library without own playlists, ${device.width} dp, ${language}, font scale ${fontScale}`, () => {
                const env = createEnv({...device, language, fontScale, config: {'library.playlistView': 'list'}});
                const {root, unmount, t} = renderLibrary(env, [{id: 'favorite', title: '我喜欢', worksNum: 0}]);
                try {
                    assertFavoriteEntry(root, t, 0, device);
                    assert.equal(findAll(root, byTestID('library-playlist-list')).length, 0, 'no empty playlist list');
                    assert.equal(findAll(root, byTestID('library-playlist-search')).length, 0, 'nothing to search');
                    assert.equal(findAll(root, byText(t('common.edit'))).length, 0, 'nothing to edit');
                    const hint = findOne(root, byText(t('library.noPlaylists')), 'no playlists hint');
                    assert.ok(!hint.textInfo.clippedVertically && !hint.textInfo.truncated, 'hint is shown in full');
                    let previousBottom = bottomOf(hint.frame);
                    for (const key of ['panel.createMusicSheet.title', 'panel.importMusicSheet.title']) {
                        // 大标题旁边的按钮也叫「新建歌单」「导入歌单」，这里只找提示下面那两行
                        const action = findOne(root, record => record.props.accessibilityLabel === t(key) && typeof record.props.onPress === 'function' && record.frame.y >= bottomOf(hint.frame) - 0.5, key);
                        assert.ok(action.frame.y >= previousBottom - 0.5, `${key} is below the hint`);
                        previousBottom = bottomOf(action.frame);
                        assert.ok(action.frame.height >= 44 - 0.5, `${key} is tall enough to tap`);
                        assert.ok(action.frame.x >= device.insets.left + 16 - 0.5 && rightOf(action.frame) <= device.width - device.insets.right - 16 + 0.5);
                        assert.equal(clippingAncestor(action), null);
                        for (const text of findAll(action, isText)) {
                            assert.ok(!text.textInfo.clippedVertically && !text.textInfo.truncated, `${text.text} is shown in full`);
                        }
                    }
                } finally {
                    unmount();
                }
            });
        }
    }
}

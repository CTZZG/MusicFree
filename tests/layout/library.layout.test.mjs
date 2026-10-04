import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    byTestID,
    clippingAncestor,
    contains,
    createModuleLoader,
    findAll,
    findOne,
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

const DEVICES = [
    {width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
    {width: 800, height: 363, scale: 3.5, insets: {top: 0, right: 24, bottom: 20, left: 24}},
];

function renderLibrary(env) {
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
            useSheetsBase: () => SHEETS,
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

for (const device of DEVICES) {
    for (const mode of ['grid', 'list']) {
        for (const language of ['zh-CN', 'en-US']) {
            for (const fontScale of [1, 2]) {
                test(`library ${mode}, ${device.width} dp, ${language}, font scale ${fontScale}`, () => {
                    const env = createEnv({...device, language, fontScale, config: {'library.playlistView': mode}});
                    const {root, unmount, t, musicBarLayout} = renderLibrary(env);
                    try {
                        const container = findOne(root, byTestID(`library-playlist-${mode}`), 'playlists');
                        const items = findAll(container, record => typeof record.props.onLongPress === 'function');
                        assert.equal(items.length, SHEETS.length);
                        const left = device.insets.left + 16;
                        const right = device.width - device.insets.right - 16;
                        let previousBottom = -Infinity;
                        for (const item of items) {
                            assert.ok(item.frame.x >= left - 0.5);
                            assert.ok(item.frame.x + item.frame.width <= right + 0.5);
                            assert.equal(clippingAncestor(item), null, 'playlist is not clipped');
                            for (const text of findAll(item, isText)) {
                                assert.ok(!text.textInfo.clippedVertically, `text ${text.text} has sufficient height`);
                                assert.ok(!text.textInfo.squeezed, `text ${text.text} has room`);
                                assert.equal(clippingAncestor(text), null);
                                assert.ok(contains(item.frame, text.frame, 1));
                            }
                            if (mode === 'list') {
                                assert.ok(Math.abs(item.frame.width - (right - left)) <= 0.5);
                                assert.ok(item.frame.height >= 64 - 0.5);
                                assert.ok(item.frame.y >= previousBottom - 0.5, 'rows do not overlap');
                                previousBottom = item.frame.y + item.frame.height;
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
                    assert.ok(rows(root)[0].props.accessibilityLabel.startsWith(rendered.t('home.favoriteSheet')));
                    assert.ok(rows(root)[1].props.accessibilityLabel.startsWith(SHEETS.find(sheet => sheet.id === 'two').title));
                    for (const text of findAll(root, isText)) {
                        assert.ok(!text.textInfo.clippedVertically, `${text.text} is tall enough`);
                        assert.equal(clippingAncestor(text), null, `${text.text} can be scrolled into view`);
                    }
                    const manageButtons = findAll(root, record => record.props.accessibilityLabel?.startsWith(rendered.t('library.managePlaylist', {name: ''})));
                    assert.equal(manageButtons.length, SHEETS.length - 1);
                    for (const button of manageButtons) {
                        assert.ok(button.frame.width >= 40 - 0.5);
                        assert.ok(button.frame.height >= 44 - 0.5);
                    }
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

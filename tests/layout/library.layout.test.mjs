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
import {createCommonStubs, createEnv, inAppFontScaleScope} from './stubs.mjs';

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

/**
 * 首页正在播放、标签栏显示时底部两栏的位置，用生产的规则和尺寸算，不写死数字：
 * 两栏尺寸调整后，这里的预留跟着变。
 */
function homeMusicBarLayout(loader) {
    const {resolveMusicBarLayout} = loader.load('@/components/musicBar/layoutPolicy');
    const sizes = loader.load('@/components/musicBar/layout');
    return resolveMusicBarLayout({
        routeSupportsMusicBar: true,
        routeHasTabBar: true,
        hasCurrentMusic: true,
        keyboardVisible: false,
        barHeight: sizes.MUSIC_BAR_HEIGHT,
        floatingBottom: sizes.MUSIC_BAR_FLOATING_BOTTOM,
        tabBarHeight: sizes.TAB_BAR_HEIGHT,
        tabBarGap: sizes.MUSIC_BAR_TAB_BAR_GAP,
    });
}

function renderLibrary(env) {
    let loader;
    const stubs = {
        ...createCommonStubs(env),
        '@react-navigation/native': strictStub('navigation', {useScrollToTop() {}}),
        '@/components/base/statusBar': strictStub('statusBar', {default: () => null}),
        // 真实的 useMusicBarFloatingOffset 读这份布局状态
        '@/components/musicBar/layoutState': strictStub('musicBarLayoutState', {
            useMusicBarLayoutState: () => ({layout: homeMusicBarLayout(loader)}),
        }),
        '@/components/dialogs/useDialog': strictStub('dialogs', {showDialog() {}}),
        '@/core/downloader': strictStub('downloader', {useDownloadQueue: () => []}),
        '@/core/musicSheet': strictStub('musicSheet', {
            default: {defaultSheet: {id: 'favorite'}},
            useSheetsBase: () => SHEETS,
            useStarredSheets: () => [],
        }),
    };
    loader = createModuleLoader(stubs);
    const Library = loader.load('@/pages/library').default;
    return {
        // 资料库是首页路由里的一个标签，字体缩放跟着 home 路由的登记
        ...renderLayout(inAppFontScaleScope(loader, {route: 'home'}, h(Library)), {
            env,
            width: env.window.width,
            height: env.window.height,
        }),
        t: loader.load('@/core/i18n').default.t,
        musicBarLayout: homeMusicBarLayout(loader),
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
                        const items = findAll(container, record => record.props.accessibilityRole === 'button');
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

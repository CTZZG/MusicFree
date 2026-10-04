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
import {createCommonStubs, createEnv} from './stubs.mjs';

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
    const stubs = {
        ...createCommonStubs(env),
        '@react-navigation/native': strictStub('navigation', {useScrollToTop() {}}),
        '@/components/base/statusBar': strictStub('statusBar', {default: () => null}),
        '@/components/musicBar/useMusicBarFloatingOffset': strictStub('floatingOffset', {default: () => 116}),
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
        ...renderLayout(h(Library), {env, width: env.window.width, height: env.window.height}),
        t: loader.load('@/core/i18n').default.t,
    };
}

for (const device of DEVICES) {
    for (const mode of ['grid', 'list']) {
        for (const language of ['zh-CN', 'en-US']) {
            for (const fontScale of [1, 2]) {
                test(`library ${mode}, ${device.width} dp, ${language}, font scale ${fontScale}`, () => {
                    const env = createEnv({...device, language, fontScale, config: {'library.playlistView': mode}});
                    const {root, unmount, t} = renderLibrary(env);
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

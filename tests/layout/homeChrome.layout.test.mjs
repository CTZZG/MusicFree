// 悬浮底栏里的真实封面、文字和触摸区域须完整放进容器。
// 两栏的间距由 layoutPolicy 测试覆盖；此处只检查栏内几何，不模拟位移动画。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    clippingAncestor,
    contains,
    createModuleLoader,
    findAll,
    isText,
    renderLayout,
    strictStub,
} from './harness.mjs';
import {createCommonStubs, createEnv} from './stubs.mjs';

const h = React.createElement;
const MUSIC = {id: 'one', platform: 'test', title: '晴天 Live at the World Tour', artist: '周杰伦', duration: 269, artwork: 'cover'};
const HOME_TAB = {HOME: 'home', SEARCH: 'search', LIBRARY: 'library', SETTINGS: 'settings'};

function loaderFor(env, dark) {
    return createModuleLoader({
        ...createCommonStubs(env),
        '@/core/theme': strictStub('theme', {default: {useTheme: () => ({dark})}}),
        '@/core/router': strictStub('router', {HOME_TAB, ROUTE_PATH: {MUSIC_DETAIL: 'music-detail'}, useNavigate: () => () => {}}),
        '@/components/base/glassBackdrop': strictStub('glass', {default: () => null}),
        '@/components/base/liquidGlassBackdrop': strictStub('liquidGlass', {default: () => null, isLiquidGlassAvailable: () => false}),
        '@/components/musicBar/layoutState': strictStub('musicBarLayout', {
            useMusicBarLayoutState: () => ({
                layout: {visible: true, barBottom: 76, reservedBottom: 136},
                keyboardVisible: false,
                transitionInProgress: false,
            }),
        }),
        '@/hooks/useResolvedMusicArtwork': strictStub('artwork', {default: () => MUSIC.artwork}),
        '@/core/trackPlayer': strictStub('trackPlayer', {
            default: {previousMusic: null, nextMusic: null},
            useCurrentMusic: () => MUSIC,
            useMusicState: () => 'playing',
            usePlayList: () => [],
            useProgress: () => ({position: 83, duration: 269}),
        }),
    });
}

for (const width of [320, 363, 412]) {
    for (const language of ['zh-CN', 'en-US']) {
        for (const dark of [false, true]) {
            test(`floating bottom bars, ${width} dp, ${language}, dark=${dark}`, () => {
                const env = createEnv({width, height: 806, language, fontScale: 2, insets: {top: 24, right: 0, bottom: 20, left: 0}});
                const loader = loaderFor(env, dark);
                const MusicBar = loader.load('@/components/musicBar').default;
                const HomeTabBar = loader.load('@/pages/home/components/tabBar').default;
                const routes = Object.values(HOME_TAB).map(name => ({name, key: name}));
                for (const element of [
                    h(MusicBar),
                    h(HomeTabBar, {state: {index: 2, routes}, navigation: {emit() {}, navigate() {}}}),
                ]) {
                    const {root, unmount} = renderLayout(element, {env, width, height: 806});
                    try {
                        const bar = root.children[0];
                        for (const text of findAll(bar, isText)) {
                            assert.ok(!text.textInfo.clippedVertically, `text ${text.text} fits vertically`);
                            assert.ok(!text.textInfo.squeezed, `text ${text.text} is readable`);
                            assert.equal(clippingAncestor(text), null);
                            assert.ok(contains(bar.frame, text.frame, 1));
                        }
                        const controls = findAll(bar, record => ['button', 'tab'].includes(record.props.accessibilityRole));
                        assert.ok(controls.length >= 3);
                        for (const control of controls) {
                            assert.ok(control.frame.width >= 44 - 0.5);
                            assert.ok(control.frame.height >= 44 - 0.5);
                            assert.equal(clippingAncestor(control), null);
                        }
                        for (const cover of findAll(bar, record => record.type === 'Image')) {
                            assert.ok(contains(bar.frame, cover.frame));
                            assert.equal(clippingAncestor(cover), null);
                        }
                    } finally {
                        unmount();
                    }
                }
            });
        }
    }
}

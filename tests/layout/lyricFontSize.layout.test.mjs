import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    assertReadable,
    byText,
    clippingAncestor,
    contains,
    createModuleLoader,
    findAll,
    findOne,
    flattenStyle,
    isText,
    renderLayout,
    strictStub,
} from './harness.mjs';
import {createCommonStubs, createEnv, inAppFontScaleScope} from './stubs.mjs';

const h = React.createElement;
const devices = [
    {width: 320, height: 640},
    {width: 363, height: 806},
    {width: 806, height: 363},
];

function panelLoader(env) {
    return createModuleLoader({
        ...createCommonStubs(env),
        '@/native/utils': strictStub('native', {default: {getWindowDimensions: () => env.window}}),
        '@react-native-community/slider': strictStub('slider', {
            default: props => h('View', props),
        }),
    });
}

function renderPanel(loader, env, props) {
    const Panel = loader.load('@/components/panels/types/setFontSize').default;
    return renderLayout(inAppFontScaleScope(loader, {panel: 'SetFontSize'}, h(Panel, props)), {
        env, width: env.window.width, height: env.window.height,
    });
}

for (const device of devices) {
    for (const language of ['zh-CN', 'zh-TW', 'en-US']) {
        for (const fontScale of [1, 1.3, 1.5, 2]) {
            test(`lyric font panel: ${device.width}×${device.height}, ${language}, ${fontScale}×`, () => {
                const env = createEnv({...device, language, fontScale, insets: {top: 24, bottom: 20, left: 0, right: 0}});
                const loader = panelLoader(env);
                const t = loader.load('@/core/i18n').default.t;
                const {root, unmount} = renderPanel(loader, env, {onSelectChange() {}});
                try {
                    const scroll = findOne(root, r => r.type === 'ScrollView');
                    assert.ok(scroll.frame.height > 44, 'content has a usable scroll viewport');
                    const radios = findAll(scroll, r => r.props.accessibilityRole === 'radio');
                    assert.equal(radios.length, 7, 'all lyric sizes, including larger sizes, remain reachable');
                    assert.deepEqual(radios.map(r => r.props.accessibilityState.checked), [false, true, false, false, false, false, false]);
                    const reset = findOne(scroll, r => r.props.accessibilityRole === 'button');
                    for (const action of [...radios, reset]) {
                        assert.ok(action.frame.height >= 44 - 0.5, 'controls stay at least 44 dp tall');
                        for (const text of findAll(action, isText)) {
                            assertReadable(text, text.text);
                            assert.ok(contains(action.frame, text.frame, 1), 'text stays in its button');
                        }
                    }
                    const preview = findOne(root, byText(t('panel.setFontSize.preview')));
                    for (const text of findAll(root, isText)) {
                        assertReadable(text, text.text);
                        assert.equal(clippingAncestor(text), null, 'text is readable by scrolling when needed');
                        const base = flattenStyle(text.props.style).fontSize;
                        assert.equal(text.metrics.fontSize, base * (text === preview ? 1 : fontScale), 'UI follows system scale; lyric preview uses the selected size');
                    }
                    assert.equal(preview.metrics.fontSize, loader.load('@/utils/rpx').default(30), 'standard preview matches the current renderer size');
                    findOne(root, byText(t('panel.setFontSize.description')));
                } finally { unmount(); }
            });
        }
    }
}

test('lyric font choices and slider apply immediately; reset restores standard', () => {
    const env = createEnv({...devices[1], fontScale: 2});
    const loader = panelLoader(env);
    const calls = [];
    const rendered = renderPanel(loader, env, {defaultSelect: 3, onSelectChange: value => calls.push(value)});
    const t = loader.load('@/core/i18n').default.t;
    const rpx = loader.load('@/utils/rpx').default;
    const selected = () => findAll(rendered.root, r => r.props.accessibilityRole === 'radio').findIndex(r => r.props.accessibilityState.checked);
    const preview = () => findOne(rendered.root, byText(t('panel.setFontSize.preview')));
    try {
        assert.equal(selected(), 3);
        assert.equal(preview().metrics.fontSize, rpx(42));
        for (const [index, expected] of [24, 30, 36, 42, 54, 66, 84].entries()) {
            const radio = findAll(rendered.root, r => r.props.accessibilityRole === 'radio')[index];
            rendered.interact(() => radio.props.onPress());
            assert.equal(selected(), index);
            assert.equal(preview().metrics.fontSize, rpx(expected));
        }
        const slider = findOne(rendered.root, r => typeof r.props.onValueChange === 'function');
        rendered.interact(() => slider.props.onValueChange(0));
        assert.equal(selected(), 0);
        assert.equal(preview().metrics.fontSize, rpx(24));
        const reset = findOne(rendered.root, r => r.props.accessibilityRole === 'button');
        rendered.interact(() => reset.props.onPress());
        assert.equal(selected(), 1);
        assert.equal(preview().metrics.fontSize, rpx(30));
        assert.deepEqual(calls, [0, 1, 2, 3, 4, 5, 6, 0, 1]);
    } finally { rendered.unmount(); }
});

test('invalid persisted lyric size falls back to standard instead of an undefined preview', () => {
    const env = createEnv({...devices[0]});
    const loader = panelLoader(env);
    const rendered = renderPanel(loader, env, {defaultSelect: 99, onSelectChange() {}});
    try {
        const radios = findAll(rendered.root, r => r.props.accessibilityRole === 'radio');
        assert.equal(radios[1].props.accessibilityState.checked, true);
    } finally { rendered.unmount(); }
});

const lines = [
    {key: 'original', text: '清晰的歌词', primary: true, hasWordByWord: true, lineStartTimeMs: 0, words: [{text: '清晰', startTime: 0, duration: 400, space: true}, {text: '的', startTime: 400, duration: 300, space: true}, {text: '歌词', startTime: 700, duration: 300}]},
    {key: 'translation', text: 'Every lyric matters', primary: false},
    {key: 'romanization', text: 'qing xi de ge ci', primary: false},
];
for (const fontScale of [1, 1.3, 1.5, 2]) {
    for (const sizeIndex of [0, 1, 2, 3, 6]) {
        for (const mode of ['ordinary', 'static-words', 'animated-words']) {
            test(`full lyric ${mode}, size ${sizeIndex}, system ${fontScale}×`, () => {
                const env = createEnv({...devices[1], fontScale, config: {'lyric.enableWordByWord': mode !== 'ordinary'}});
                const loader = createModuleLoader({
                    ...createCommonStubs(env),
                    '@/core/lyricManager': strictStub('lyric manager', {getCurrentPositionMsShared: () => ({value: 500})}),
                });
                const LyricItem = loader.load('@/pages/musicDetail/components/content/lyric/lyricItem').default;
                const size = loader.load('@/utils/detailLyricFontSize').getDetailLyricFontSize(sizeIndex);
                const rendered = renderLayout(h(LyricItem, {lines, fontSize: size, secondaryFontScale: 0.75, highlight: mode === 'animated-words'}), {env, width: env.window.width, height: env.window.height});
                try {
                    const texts = findAll(rendered.root, isText);
                    assert.ok(texts.length >= 3, 'original, translation and romanization are rendered');
                    assert.equal(texts.length > 3, mode !== 'ordinary', 'word cases actually exercise word renderers, including spaces');
                    for (const text of texts) {
                        assert.equal(text.props.allowFontScaling, false, 'all lyric text paths use custom scaling');
                        assert.equal(text.metrics.fontSize, flattenStyle(text.props.style).fontSize, 'system multiplier is not compounded');
                        assertReadable(text, text.text);
                    }
                    for (const key of ['Every lyric matters', 'qing xi de ge ci']) {
                        assert.equal(findOne(rendered.root, byText(key)).metrics.fontSize, size * 0.75, 'secondary size ratio is preserved');
                    }
                } finally { rendered.unmount(); }
            });
        }
    }
}

for (const highlight of [false, true]) {
    test(`word-by-word translation and romanization keep their own size ratio, highlight=${highlight}`, () => {
        const env = createEnv({...devices[1], fontScale: 2});
        const loader = createModuleLoader({
            ...createCommonStubs(env),
            '@/core/lyricManager': strictStub('lyric manager', {getCurrentPositionMsShared: () => ({value: 500})}),
        });
        const LyricItem = loader.load('@/pages/musicDetail/components/content/lyric/lyricItem').default;
        const secondaryLines = ['translation', 'romanization'].map((key, index) => ({
            key, text: index ? 'qing xi' : 'Clear lyrics', primary: false, hasWordByWord: true, lineStartTimeMs: 0,
            words: [{text: index ? 'qing' : 'Clear', startTime: 0, duration: 400, space: true}, {text: index ? 'xi' : 'lyrics', startTime: 400, duration: 500}],
        }));
        const rendered = renderLayout(h(LyricItem, {lines: secondaryLines, fontSize: 20, secondaryFontScale: 0.75, highlight}), {env, width: env.window.width, height: env.window.height});
        try {
            const texts = findAll(rendered.root, isText);
            assert.ok(texts.length > 4, 'secondary words and their spaces are rendered');
            for (const text of texts) {
                assert.equal(text.props.allowFontScaling, false);
                assert.equal(text.metrics.fontSize, 15, 'custom secondary ratio is preserved without system compounding');
                assertReadable(text, text.text);
            }
        } finally { rendered.unmount(); }
    });
}

test('the largest lyric preview stays readable and scrollable on a small landscape screen', () => {
    const env = createEnv({...devices[2], fontScale: 2, language: 'en-US'});
    const loader = panelLoader(env);
    const rendered = renderPanel(loader, env, {defaultSelect: 6, onSelectChange() {}});
    try {
        const t = loader.load('@/core/i18n').default.t;
        const preview = findOne(rendered.root, byText(t('panel.setFontSize.preview')));
        assert.equal(preview.metrics.fontSize, loader.load('@/utils/rpx').default(84));
        assertReadable(preview, preview.text);
        assert.equal(clippingAncestor(preview), null);
        assert.equal(findAll(rendered.root, r => r.props.accessibilityRole === 'radio')[6].props.accessibilityState.checked, true);
    } finally { rendered.unmount(); }
});

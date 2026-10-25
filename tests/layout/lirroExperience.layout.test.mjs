import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React, assertReadable, contains, createModuleLoader, findAll,
    findOne, isText, renderLayout, strictStub,
} from './harness.mjs';
import {FlatListStub, createCommonStubs, createEnv, inAppFontScaleScope} from './stubs.mjs';

const h = React.createElement;
const noop = () => {};
const musicItem = {id: 'one', platform: 'fixture', title: 'A title', artist: 'Artist'};
const lyrics = [{lrc: 'First line', translation: '第一句译文'}, {lrc: '第二句很长的歌词，保持可读，不要挤出按钮'}];
for (const device of [{width: 320, height: 640}, {width: 363, height: 806}, {width: 806, height: 363}]) {
    for (const language of ['zh-CN', 'zh-TW', 'en-US']) {
        for (const fontScale of [1, 1.3, 1.5, 2]) {
            for (const [panel, source] of [
                ['HomeSections', 'homeSections'], ['LyricTools', 'lyricTools'], ['MusicShare', 'musicShare'],
            ]) {
                test(`${panel}: ${device.width}×${device.height}, ${language}, ${fontScale}×`, () => {
                    const env = createEnv({...device, language, fontScale, insets: {top: 24, bottom: 20, left: 0, right: 0}});
                    const common = createCommonStubs(env);
                    const loader = createModuleLoader({
                        ...common,
                        'react-native': strictStub('RN with native switch boundary', {
                            ...common['react-native'],
                            Switch: props => h('View', {...props, style: {width: 52, height: 32}}),
                            FlatList: FlatListStub,
                            Share: {share: noop},
                        }),
                        '@/native/utils': strictStub('native', {default: {getWindowDimensions: () => env.window}}),
                        '@/core/trackPlayer': strictStub('player', {default: {currentMusic: musicItem}}),
                        '@/core/lyricManager': strictStub('lyrics', {
                            default: {lyricState: {loading: false, lyrics}, getLyricDiagnosticSnapshot: () => ({parserMatchesCurrentMusic: true})},
                            useLyricState: () => ({hasRomanization: false}),
                        }),
                        '@/hooks/useResolvedMusicArtwork': strictStub('artwork', {default: () => undefined}),
                        '@/utils/mediaUtils': strictStub('matching current song', {isSameMediaItem: () => true}),
                        'react-native-image-colors': strictStub('palette', {default: {getColors: noop}}),
                        '@/core/musicShare': strictStub('textShare', {formatMusicShareMessage: noop}),
                        '@/components/musicShare/shareImage': strictStub('imageExport', {captureShareCard: noop, shareCardPng: noop}),
                        // SVG drawing is checked by native PNG evidence; this boundary supplies its real aspect ratio.
                        '@/components/musicShare/shareCard': strictStub('SVG', {default: ({width}) => h('View', {style: {width, height: width * .6}})}),
                    });
                    const Panel = loader.load(`@/components/panels/types/${source}`).default;
                    const {root, unmount} = renderLayout(inAppFontScaleScope(loader, {panel}, h(Panel, {musicItem, onDisplayChanged: noop})), {
                        env, width: device.width, height: device.height,
                    });
                    try {
                        const scroll = findOne(root, r => r.type === 'ScrollView');
                        assert.ok(scroll.frame.height > 44, 'content remains scrollable on small/landscape screens');
                        assert.ok(scroll.frame.height < device.height, 'the scroll viewport stays bounded');
                        for (const text of findAll(root, isText)) {
                            assertReadable(text, text.text);
                            assert.ok(text.frame.x >= -1 && text.frame.x + text.frame.width <= device.width + 1, `${text.text} stays within the screen`);
                        }
                        for (const action of findAll(scroll, r => ['button', 'checkbox', 'radio'].includes(r.props.accessibilityRole))) {
                            assert.ok(action.frame.height >= 44 - .5, 'actions remain touchable');
                            for (const text of findAll(action, isText)) assert.ok(contains(action.frame, text.frame, 1), `${text.text} stays in its action`);
                        }
                    } finally { unmount(); }
                });
            }
        }
    }
}

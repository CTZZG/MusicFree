import assert from 'node:assert/strict';
import {test} from 'node:test';
import {React, assertReadable, contains, createModuleLoader, findAll, findOne, flattenStyle, isText, renderLayout, strictStub} from './harness.mjs';
import {createCommonStubs, createEnv, inAppFontScaleScope} from './stubs.mjs';

const h = React.createElement;
const noop = () => {};
const musicItem = {id: '1', platform: 'Source', title: '一首很长很长的歌曲名称 · A very long song title', artist: 'Artist', album: '', artwork: '', duration: 180};
const notice = {id: 1, musicItem, failure: {code: 'access-denied', pluginName: 'Source'}};
const devices = [
    {width: 320, height: 640},
    {width: 363, height: 806},
    {width: 806, height: 363},
];
for (const device of devices) {
    for (const language of ['zh-CN', 'en-US']) {
        for (const fontScale of [1, 1.3, 1.5, 2]) {
            for (const panel of ['MusicQuality', 'PlaybackRecovery']) {
                test(`${panel}: ${device.width}×${device.height}, ${language}, ${fontScale}×`, () => {
                    const env = createEnv({...device, language, fontScale, insets: {top: 24, bottom: 20, left: 0, right: 0}});
                    const loader = createModuleLoader({
                        ...createCommonStubs(env),
                        '@/native/utils': strictStub('native', {default: {getWindowDimensions: () => env.window}}),
                        '@/core/router': strictStub('router', {useNavigate: () => noop, navigateToSearch: noop, ROUTE_PATH: {SETTING: 'setting'}}),
                        '@/core/trackPlayer': strictStub('player', {default: {retryPlayback: noop}}),
                        '@/core/trackPlayer/playbackRecovery': strictStub('recovery', {playbackRecovery: {state: {getValue: () => notice}, dismiss: noop}}),
                        '@/core/pluginManager': strictStub('plugins', {default: {getByMedia: () => ({instance: {supportedQualities: ['128k', 'flac']}})}}),
                        '@/utils/fileUtils': strictStub('files', {sizeFormatter: () => '10 MB'}),
                    });
                    const Panel = loader.load(panel === 'MusicQuality' ? '@/components/panels/types/musicQuality' : '@/components/panels/types/playbackRecovery').default;
                    const props = panel === 'MusicQuality' ? {musicItem, currentQuality: 'flac', onQualityPress: noop} : {notice};
                    const {root, unmount} = renderLayout(inAppFontScaleScope(loader, {panel}, h(Panel, props)), {env, width: env.window.width, height: env.window.height});
                    try {
                        const scroll = findOne(root, r => r.type === 'ScrollView');
                        const rows = findAll(scroll, r => r.props.accessibilityRole === 'button');
                        assert.ok(rows.length >= 2);
                        for (const row of rows) {
                            assert.ok(row.frame.height >= 44 - 0.5, 'actions remain at least 44 dp high');
                            for (const text of findAll(row, isText)) {
                                assertReadable(text, text.text);
                                assert.ok(contains(row.frame, text.frame, 1), `${text.text} stays in its action`);
                            }
                        }
                        for (const text of findAll(root, isText)) {
                            assertReadable(text, text.text);
                            assert.equal(text.metrics.fontSize, flattenStyle(text.props.style).fontSize * fontScale, 'text follows system scaling');
                        }
                        if (panel === 'MusicQuality') {
                            assert.equal(rows.filter(r => r.props.accessibilityState?.selected).length, 1, 'resolved quality is marked');
                        }
                    } finally { unmount(); }
                });
            }
        }
    }
}

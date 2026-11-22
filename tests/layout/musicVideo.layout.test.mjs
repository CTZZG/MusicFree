import assert from 'node:assert/strict';
import {test} from 'node:test';
import {React, assertReadable, contains, createModuleLoader, findAll, findOne, isText, renderLayout, strictStub} from './harness.mjs';
import {createCommonStubs, createEnv, inAppFontScaleScope} from './stubs.mjs';
const h = React.createElement;
const noop = () => {};
for (const device of [{width: 320, height: 640}, {width: 363, height: 806}, {width: 806, height: 363}]) {
    for (const language of ['zh-CN', 'zh-TW', 'en-US']) {
        for (const fontScale of [1, 1.3, 1.5, 2]) {
            test(`MusicVideo panel ${device.width}×${device.height} ${language} ${fontScale}×`, async () => {
                const env = createEnv({...device, language, fontScale, insets: {top: 24, bottom: 20, left: 0, right: 0}});
                const song = {id: 'a', platform: 'fixture'};
                const candidate = {id: 'v', title: 'A very long music video title 含中日韓歌词', providerKey: 'fixture', providerName: 'Video provider', artist: 'A very long artist name', durationSeconds: 123,
                    qualities: [{id: '720p', label: 'HD 720p'}, {id: '1080p', label: 'A long source quality label 1080p'}]};
                const loader = createModuleLoader({
                    ...createCommonStubs(env),
                    '@/native/utils': strictStub('native viewport', {default: {getWindowDimensions: () => env.window}}),
                    '@/core/trackPlayer': strictStub('existing player', {
                        default: {findMusicVideos: async () => [candidate], cancelVideoRequest: noop},
                        useCurrentMusic: () => song,
                        useMusicVideoState: () => ({phase: 'video', songKey: 'fixture@a', owner: {kind: 'mv', loadGeneration: 2}, video: {...candidate, qualityId: '720p'}, canReturn: true, error: 'network'}),
                    }),
                    '@/components/musicVideo/actions': strictStub('owned player commands', {watchMusicVideo: noop, changeMusicVideoQuality: noop, returnToSong: noop, resumeMusicVideo: noop}),
                });
                const Panel = loader.load('@/components/panels/types/musicVideo').default;
                const layout = renderLayout(inAppFontScaleScope(loader, {panel: 'MusicVideo'}, h(Panel)), {env, width: device.width, height: device.height});
                try {
                    await React.act(async () => { await Promise.resolve(); });
                    const root = layout.interact(noop);
                    const scroll = findOne(root, r => r.type === 'ScrollView');
                    assert.ok(scroll.frame.height >= 48 && scroll.frame.height < device.height, 'bounded candidate viewport');
                    const buttons = findAll(scroll, r => r.props.accessibilityRole === 'button');
                    assert.ok(buttons.length >= 1);
                    for (const text of findAll(root, isText)) {
                        assertReadable(text, text.text);
                        assert.equal(text.props.allowFontScaling, true, 'real MusicVideo font scope follows system');
                        assert.ok(text.frame.x >= -1 && text.frame.x + text.frame.width <= device.width + 1);
                    }
                    for (const button of buttons) {
                        assert.ok(button.frame.height >= 48 - .5, '48dp action');
                        for (const text of findAll(button, isText)) assert.ok(contains(button.frame, text.frame, 1), 'label remains inside action');
                    }
                } finally { layout.unmount(); }
            });
        }
    }
}

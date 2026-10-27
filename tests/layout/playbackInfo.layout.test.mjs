import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    assertReadable,
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
const noop = () => {};
for (const device of [
    {width: 320, height: 640},
    {width: 363, height: 806},
    {width: 806, height: 363},
]) {
    for (const language of ['zh-CN', 'zh-TW', 'en-US']) {
        for (const fontScale of [1, 1.3, 1.5, 2]) {
            for (const populated of [false, true]) {
                test(`PlaybackInfo ${populated ? 'decoded' : 'unknown'} ${
                    device.width
                }×${device.height} ${language} ${fontScale}×`, async () => {
                    const env = createEnv({
                        ...device,
                        language,
                        fontScale,
                        insets: {top: 24, bottom: 20, left: 0, right: 0},
                    });
                    const song = {
                        id: 'one',
                        platform: 'Original source',
                        title: 'A long title with 中日韓歌词 and different source',
                    };
                    const adapter = {
                        getAudioInfo: async () =>
                            populated
                                ? {
                                      mediaId: 'one',
                                      loadGeneration: 1,
                                      codec: 'pcm_s16le'.repeat(6),
                                      sampleRate: 192000,
                                      channelCount: 8,
                                      bitrate: 9216000,
                                  }
                                : null,
                        addEventListener: () => ({remove: noop}),
                    };
                    const loader = createModuleLoader({
                        ...createCommonStubs(env),
                        '@/utils/mediaUtils': strictStub('media identity', {
                            getMediaUniqueKey: item =>
                                `${item.platform}@${item.id}`,
                        }),
                        '@/native/utils': strictStub('native window', {
                            default: {getWindowDimensions: () => env.window},
                        }),
                        '@/core/trackPlayer': strictStub('existing player', {
                            default: {
                                isReady: true,
                                currentMusic: song,
                                playerAdapter: adapter,
                            },
                            useCurrentMusic: () => song,
                            useMusicQuality: () => '128k',
                            useAlternateSourceInUse: () => 'Actual source B',
                        }),
                    });
                    const Panel = loader.load(
                        '@/components/panels/types/playbackInfo',
                    ).default;
                    const layout = renderLayout(
                        inAppFontScaleScope(loader, {panel: 'PlaybackInfo'}, h(Panel)),
                        {env, width: device.width, height: device.height},
                    );
                    try {
                        await React.act(async () => {
                            await Promise.resolve();
                        });
                        const root = layout.interact(noop);
                        const scroll = findOne(
                            root,
                            r => r.type === 'ScrollView',
                        );
                        assert.ok(
                            scroll.frame.height > 44 &&
                                scroll.frame.height < device.height,
                            'scroll viewport is bounded',
                        );
                        for (const text of findAll(root, isText)) {
                            assertReadable(text, text.text);
                            assert.equal(text.props.allowFontScaling, true, 'panel text follows system font size');
                            assert.ok(
                                text.frame.x >= -1 &&
                                    text.frame.x + text.frame.width <=
                                        device.width + 1,
                                'text stays within viewport width',
                            );
                        }
                        const buttons = findAll(
                            scroll,
                            r => r.props.accessibilityRole === 'button',
                        );
                        assert.equal(buttons.length, 1);
                        assert.ok(buttons[0].frame.height >= 48 - 0.5);
                        for (const text of findAll(buttons[0], isText))
                            assert.ok(
                                contains(buttons[0].frame, text.frame, 1),
                            );
                        if (populated)
                            assert.ok(
                                findAll(root, isText).some(r =>
                                    r.text.includes('192 kHz'),
                                ),
                                'actual decoded snapshot was laid out',
                            );
                    } finally {
                        layout.unmount();
                    }
                });
            }
        }
    }
}

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React, assertReadable, clippingAncestor, contains, createModuleLoader,
    findAll, findOne, flattenStyle, isText, renderLayout, strictStub,
} from './harness.mjs';
import {FlashListGrid, createCommonStubs, createEnv, inAppFontScaleScope} from './stubs.mjs';

const h = React.createElement;
const noop = () => {};
const songs = [
    {id: 'a', title: '一首特别特别长的中文歌曲名称（现场版）', artist: '一位名字很长的歌手', platform: '网易云音乐'},
    {id: 'b', title: 'Whatever Happens in a Very Long Song Title', artist: 'Michael Jackson', platform: 'An unusually long source name'},
    {id: 'c', title: '最后一首歌曲', artist: 'Artist', platform: 'Source'},
];
const devices = [
    {width: 320, height: 640},
    {width: 363, height: 806},
    {width: 806, height: 363},
];
for (const device of devices) {
    for (const language of ['zh-CN', 'en-US']) {
        for (const fontScale of [1, 1.3, 1.5, 2]) {
            for (const state of ['priority', 'removed', 'cleared']) {
                test(`PlayList: ${device.width}×${device.height}, ${language}, ${fontScale}×, ${state}`, () => {
                    const env = createEnv({...device, language, fontScale, insets: {top: 24, bottom: 20, left: 0, right: 0}});
                    const common = createCommonStubs(env);
                    const later = state === 'cleared' ? [] : [songs[2], songs[0]];
                    const queue = state === 'cleared' ? [] : songs;
                    const undo = state === 'priority' ? null : {id: 1, action: state === 'removed' ? 'remove' : 'clear', count: 5};
                    const loader = createModuleLoader({
                        ...common,
                        '@/utils/mediaExtra': strictStub('media extra', {getMediaExtraProperty: () => undefined}),
                        'react-native-reanimated': {
                            ...common['react-native-reanimated'],
                            // Settle the panel's entrance animation, which turns loading off.
                            useAnimatedReaction: (_, reaction) => React.useEffect(() => reaction(1, null), [reaction]),
                        },
                        '@shopify/flash-list': strictStub('FlashList', {FlashList: FlashListGrid}),
                        '@/native/utils': strictStub('native', {default: {getWindowDimensions: () => env.window}}),
                        '@/core/trackPlayer': strictStub('player', {
                            default: {
                                toggleRepeatMode: noop, clearQueueWithUndo: noop,
                                removeQueueItemWithUndo: noop, undoQueueEdit: noop,
                                play: noop, removePlayLater: noop, playList: queue, playLaterQueue: later,
                                isCurrentMusic: item => item.id === 'b',
                            },
                            usePlayList: () => queue,
                            usePlayLaterQueue: () => later,
                            useCurrentMusic: () => state === 'cleared' ? null : songs[1],
                            useRepeatMode: () => 'QUEUE',
                            useQueueUndo: () => undo,
                        }),
                    });
                    const Panel = loader.load('@/components/panels/types/playList').default;
                    const {root, unmount} = renderLayout(inAppFontScaleScope(loader, {panel: 'PlayList'}, h(Panel)), {env, width: device.width, height: device.height});
                    try {
                        const buttons = findAll(root, node => node.props.accessibilityRole === 'button');
                        assert.ok(buttons.length >= 2);
                        for (const button of buttons) {
                            assert.ok(button.frame.height >= 44 - 0.5, 'actions have 44 dp height');
                            assert.ok(button.frame.width >= 44 - 0.5, 'actions have 44 dp width');
                            for (const text of findAll(button, isText)) {
                                assertReadable(text, text.text);
                                assert.ok(contains(button.frame, text.frame, 1), `${text.text} stays inside its action`);
                            }
                        }
                        for (const text of findAll(root, isText)) {
                            assertReadable(text, text.text);
                            assert.equal(text.metrics.fontSize, flattenStyle(text.props.style).fontSize * fontScale, 'all queue text follows system scaling');
                            assert.equal(clippingAncestor(text), null, `${text.text} is not clipped`);
                        }
                        if (undo) {
                            const button = findOne(root, node => node.props.accessibilityRole === 'button' && findAll(node, isText).some(text => ['撤销', 'Undo'].includes(text.text)));
                            assert.ok(button.frame.y + button.frame.height <= device.height - env.insets.bottom + 1, 'undo is above the bottom safe area');
                        }
                        if (state !== 'cleared') {
                            const scroll = findOne(root, node => node.type === 'ScrollView');
                            assert.ok(scroll.frame.height >= 44, 'at least one action remains reachable in the list viewport');
                            assert.ok(findAll(scroll, node => node.props.accessibilityRole === 'button').length >= 9, 'real queue rows render after the entrance animation');
                        }
                    } finally { unmount(); }
                });
            }
        }
    }
}

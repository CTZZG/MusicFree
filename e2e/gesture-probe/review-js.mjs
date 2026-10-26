import assert from 'node:assert/strict';
import fs from 'node:fs';
import { React, createModuleLoader, findOne, renderLayout, strictStub } from '../../tests/layout/harness.mjs';
import { createCommonStubs, createEnv } from '../../tests/layout/stubs.mjs';

const samples = [];
for (const [name, translationX, velocityX, expected] of [
    ['right-moving', 80, 200, 'previous'],
    ['left-held', -80, 0, 'next'],
    ['short-held', 10, 0, 'none'],
    ['right-held', 80, 0, 'previous'],
]) {
    const env = createEnv({width: 200, height: 64, language: 'en-US', fontScale: 1});
    const common = createCommonStubs(env);
    const callbacks = {};
    const calls = [];
    const make = type => {
        const builder = {};
        for (const method of ['minPointers', 'maxPointers', 'runOnJS']) builder[method] = () => builder;
        for (const method of ['onEnd', 'onUpdate']) builder[method] = fn => { callbacks[type + method] = fn; return builder; };
        return builder;
    };
    const song = {id:'b', platform:'fixture', title:'B', artist:'Artist', duration:180};
    const loader = createModuleLoader({
        ...common,
        'react-native-gesture-handler': strictStub('gesture boundary', {
            Gesture: {Tap: () => make('tap'), Pan: () => make('pan'), Race: (...values) => values},
            GestureDetector: ({children}) => children,
        }),
        'react-native-reanimated': strictStub('animation boundary', {
            ...common['react-native-reanimated'],
            withTiming: (target, _config, done) => { done?.(true); return target; },
        }),
        '@/hooks/useResolvedMusicArtwork': strictStub('artwork boundary', {default: () => undefined}),
        '@/core/trackPlayer': strictStub('player command boundary', {
            default: {
                previousMusic:{...song,id:'a',title:'A'}, nextMusic:{...song,id:'c',title:'C'},
                skipToNext: async () => { calls.push('next'); },
                skipToPrevious: async () => { calls.push('previous'); },
            },
            useCurrentMusic: () => song,
            usePlayList: () => [song],
            useProgress: () => ({position:0,duration:180,buffered:0}),
        }),
    });
    const MusicInfo = loader.load('@/components/musicBar/musicInfo').default;
    const layout = renderLayout(React.createElement(MusicInfo,{musicItem:song}),{env,width:200,height:64});
    try {
        const container = findOne(layout.root, n => typeof n.props.onLayout === 'function');
        await React.act(async () => {
            container.props.onLayout({nativeEvent:{layout:{width:200,height:64}}});
            callbacks.panonEnd({translationX, velocityX}, true);
        });
        const actual = calls[0] ?? 'none';
        if (name !== 'right-held') assert.equal(actual, expected, 'control did not execute the actual gesture callback');
        samples.push({name,translationX,velocityX,expected,actual,matches:actual===expected});
    } finally { layout.unmount(); }
}
if (!process.argv[2]) throw new Error('Provide an output JSON path');
fs.writeFileSync(process.argv[2],JSON.stringify({samples,scope:'actual JS component/onEnd with device/animation boundaries replaced; not native gesture or screen evidence'},null,2));
console.log(JSON.stringify(samples));

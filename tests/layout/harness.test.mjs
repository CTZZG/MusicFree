// 布局测试工具自身：排版规则与 RN 一致的几处关键行为，以及遇到不认识的东西时
// 一定报错。布局测试的结论依赖这些行为，改工具时这里先要过。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    clippingAncestor,
    createModuleLoader,
    createReactNativeStub,
    findAll,
    findOne,
    isText,
    renderLayout,
    strictStub,
} from './harness.mjs';

const h = React.createElement;

function layout(element, {width = 360, height = 640, fontScale = 1} = {}) {
    const env = {window: {width, height, scale: 2, fontScale}};
    return renderLayout(element, {env, width, height});
}

const byKey = key => record => record.props.nativeID === key;

test('percentages, aspect ratio, padding, margin and gap follow Yoga', () => {
    const {root, unmount} = layout(
        h(
            'View',
            {style: {flexDirection: 'row', padding: 10, gap: 8}},
            h('View', {nativeID: 'a', style: {width: '50%', aspectRatio: 1}}),
            h('View', {nativeID: 'b', style: {flex: 1, height: 20, marginTop: 5}}),
        ),
    );
    try {
        const a = findOne(root, byKey('a'), 'a').frame;
        const b = findOne(root, byKey('b'), 'b').frame;
        // 百分比按父视图内容区（360 - 20）算
        assert.deepEqual([a.x, a.y, a.width, a.height], [10, 10, 170, 170]);
        assert.deepEqual([b.x, b.y, b.width, b.height], [188, 15, 162, 20]);
    } finally {
        unmount();
    }
});

test('flexShrink, min/max sizes and absolute positioning follow Yoga', () => {
    const {root, unmount} = layout(
        h(
            'View',
            {style: {width: 100, height: 50, flexDirection: 'row'}},
            h('View', {nativeID: 'shrink', style: {width: 80, flexShrink: 1, minWidth: 30}}),
            h('View', {nativeID: 'fixed', style: {width: 60}}),
            h('View', {
                nativeID: 'overlay',
                style: {position: 'absolute', right: 0, bottom: 0, width: 10, maxHeight: 4, height: 9},
            }),
        ),
    );
    try {
        assert.equal(findOne(root, byKey('shrink'), 'shrink').frame.width, 40);
        assert.equal(findOne(root, byKey('fixed'), 'fixed').frame.width, 60);
        const overlay = findOne(root, byKey('overlay'), 'overlay').frame;
        assert.deepEqual([overlay.x, overlay.y, overlay.height], [90, 46, 4]);
    } finally {
        unmount();
    }
});

test('scroll content is not limited along the scroll axis, but is clipped across it', () => {
    const {root, unmount} = layout(
        h(
            'View',
            {style: {height: 100}},
            h(
                'ScrollView',
                {contentContainerStyle: {padding: 4}},
                h('View', {nativeID: 'tall', style: {height: 300}}),
                h('View', {nativeID: 'wide', style: {width: 500, height: 10}}),
            ),
        ),
    );
    try {
        const scroll = findOne(root, record => record.type === 'ScrollView', 'scroll');
        const tall = findOne(root, byKey('tall'), 'tall');
        assert.equal(scroll.frame.height, 100);
        assert.equal(tall.frame.height, 300);
        // 竖向滚动：超出下边不算裁掉，超出右边才算
        assert.equal(clippingAncestor(tall), null);
        assert.equal(clippingAncestor(findOne(root, byKey('wide'), 'wide')), scroll);
    } finally {
        unmount();
    }
});

test('overflow: hidden clips, and text squeezed or cut off is reported', () => {
    const {root, unmount} = layout(
        h(
            'View',
            {style: {width: 200}},
            h(
                'View',
                {style: {height: 30, overflow: 'hidden'}},
                h('View', {nativeID: 'tall', style: {height: 40}}),
            ),
            // 横排默认拉伸：文字只分到 30 的高度，这一行字要 40
            h(
                'View',
                {style: {height: 30, flexDirection: 'row'}},
                h('Text', {style: {fontSize: 20, lineHeight: 40}}, '放不下'),
            ),
            h(
                'View',
                {style: {flexDirection: 'row'}},
                h('View', {style: {width: 200}}),
                h('Text', {style: {fontSize: 16, flexShrink: 1}}, '挤没了'),
            ),
        ),
    );
    try {
        assert.notEqual(clippingAncestor(findOne(root, byKey('tall'), 'tall')), null);
        const [cut, squeezed] = findAll(root, isText);
        assert.equal(cut.textInfo.clippedVertically, true);
        assert.equal(squeezed.textInfo.squeezed, true);
    } finally {
        unmount();
    }
});

test('text wraps at spaces, between CJK characters, and inside words too long for a line', () => {
    const {root, unmount} = layout(
        h(
            'View',
            {style: {width: 100}},
            // 每个小写字母 8 × 0.52 = 4.16：两个 9 个字母的词一行放不下
            h('Text', {style: {fontSize: 8, lineHeight: 10}}, 'abcdefghi abcdefghi abcdefghi'),
            // 每个汉字 10：一行 10 个
            h('Text', {style: {fontSize: 10, lineHeight: 12}}, '一二三四五六七八九十一二三'),
            h('Text', {style: {fontSize: 10, lineHeight: 12}}, 'a'.repeat(30)),
        ),
    );
    try {
        const [words, cjk, longWord] = findAll(root, isText);
        assert.equal(words.textInfo.neededLines, 2);
        assert.equal(words.frame.height, 20);
        assert.equal(cjk.textInfo.neededLines, 2);
        assert.equal(longWord.textInfo.neededLines, 2);
    } finally {
        unmount();
    }
});

test('system font scale respects allowFontScaling, maxFontSizeMultiplier and numberOfLines', () => {
    const {root, unmount} = layout(
        h(
            'View',
            {style: {width: 300}},
            h('Text', {style: {fontSize: 10, lineHeight: 10}}, 'scaled'),
            h('Text', {allowFontScaling: false, style: {fontSize: 10, lineHeight: 10}}, 'fixed'),
            h('Text', {maxFontSizeMultiplier: 1.5, style: {fontSize: 10, lineHeight: 10}}, 'capped'),
            h('Text', {numberOfLines: 1, style: {fontSize: 30, lineHeight: 30}}, '一句很长很长很长很长很长很长的话'),
        ),
        {fontScale: 2},
    );
    try {
        const [scaled, fixed, capped, oneLine] = findAll(root, isText);
        assert.equal(scaled.frame.height, 20);
        assert.equal(fixed.frame.height, 10);
        assert.equal(capped.frame.height, 15);
        assert.equal(oneLine.frame.height, 60);
        assert.equal(oneLine.textInfo.truncated, true);
    } finally {
        unmount();
    }
});

test('onLayout is delivered until the layout settles', () => {
    function HalfWidth() {
        const [width, setWidth] = React.useState(0);
        return h(
            'View',
            {onLayout: event => setWidth(event.nativeEvent.layout.width)},
            h('View', {nativeID: 'half', style: {width: width / 2, height: 10}}),
        );
    }
    const {root, passes, unmount} = layout(h(HalfWidth));
    try {
        assert.equal(findOne(root, byKey('half'), 'half').frame.width, 180);
        assert.equal(passes, 2);
    } finally {
        unmount();
    }
});

test('anything it does not understand fails loudly instead of measuring as zero', () => {
    const cases = [
        [h('View', {style: {inset: 4}}), /Unsupported style key "inset"/],
        [h('View', {style: {width: '50vw'}}), /Unsupported width value/],
        [h('RNSVGSvgView', {}), /Unknown host component "RNSVGSvgView"/],
        [h('Image', {style: {width: 20}}), /Image without a size/],
        [h('Text', {adjustsFontSizeToFit: true}, 'x'), /adjustsFontSizeToFit is not modelled/],
        [h('View', {}, 'loose text'), /Raw text "loose text" outside <Text>/],
    ];
    for (const [element, message] of cases) {
        assert.throws(() => layout(element), message);
    }

    const env = {window: {width: 360, height: 640, scale: 2, fontScale: 1}};
    const loader = createModuleLoader({'react-native': createReactNativeStub(env)});
    // 页面依赖的原生包没有桩时直接报出是谁引入的
    assert.throws(
        () => loader.load('@/components/base/fastImage'),
        /"expo-image" \(imported by src\/components\/base\/fastImage.tsx\) needs a stub/,
    );
    assert.throws(
        () => strictStub('service', {ready: true}).missing,
        /Stub "service" has no export "missing"/,
    );
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React, clippingAncestor, contains, createModuleLoader, findAll,
    isText, renderLayout, strictStub,
} from './harness.mjs';
import {createCommonStubs, createEnv, inAppFontScaleScope} from './stubs.mjs';

const h = React.createElement;
const chart = (id, title, extra = {}) => ({id, title, platform: 'source', ...extra});
const preview = [
    {title: 'Whatever Happens in a Very Long Song Title', artist: 'Michael Jackson'},
    {title: '一首名字很长很长的中文歌曲', artist: '歌手'},
    {title: 'Ready for War', artist: 'Artist'},
];
const SECTIONS = [
    {title: '热门榜单', data: [chart('hot', '热歌榜', {coverImg: 'hot', musicList: preview})]},
    {title: '资料库榜', data: [
        chart('one', '最新入库', {coverImg: 'one'}),
        chart('two', 'Long Chart Name with Many Words', {artwork: 'two'}),
        chart('three', '年代新歌'),
        chart('four', '华语经典怀旧金曲精选榜'),
        chart('five', ''),
        chart('six', '随机发现', {musicList: {invalid: true}}),
    ]},
    // 混合数据仍保持插件顺序，横卡应自动占完整一行。
    {title: '更多', data: [
        chart('mixed-tile', '流行'),
        chart('mixed-preview', '更多热歌', {musicList: preview}),
        chart('last', '最后一个榜单'),
    ]},
];
const DEVICES = [
    {width: 320, height: 640, panelWidth: 320},
    {width: 363, height: 806, panelWidth: 363},
    {width: 412, height: 806, panelWidth: 300},
    {width: 800, height: 363, panelWidth: 704},
];

for (const device of DEVICES) {
    for (const language of ['zh-CN', 'en-US']) {
        for (const dark of [false, true]) {
            test(`charts in ${device.panelWidth} dp panel, ${language}, dark=${dark}`, () => {
                const env = createEnv({...device, language});
                const loader = createModuleLoader({
                    ...createCommonStubs(env),
                    '@/hooks/useColors': strictStub('colors', {default: () => ({
                        card: dark ? '#1C1C1E' : '#FFFFFF',
                        text: dark ? '#FFFFFF' : '#000000',
                        textSecondary: dark ? '#AAAAAA' : '#666666',
                        placeholder: '#808080',
                        primary: '#007AFF',
                    })}),
                    '@/components/base/listEmpty': strictStub('listEmpty', {default: () => null}),
                    '@/components/base/loading': strictStub('loading', {default: () => null}),
                    '@/components/musicBar/useMusicBarFloatingOffset': strictStub('floatingOffset', {default: extra => 68 + extra}),
                });
                const BoardPanel = loader.load('@/pages/topList/components/boardPanel').default;
                const {RequestStateCode} = loader.load('@/constants/commonConst');
                // 字体缩放跟着榜单页（top-list 路由）的登记
                const {root, unmount} = renderLayout(
                    inAppFontScaleScope(loader, {route: 'top-list'},
                        h('View', {style: {width: device.panelWidth, height: device.height}},
                            h(BoardPanel, {hash: 'source', topListData: {state: RequestStateCode.FINISHED, data: SECTIONS}}))),
                    {env, width: device.width, height: device.height},
                );
                try {
                    const cards = findAll(root, node => node.props.accessibilityRole === 'button');
                    assert.equal(cards.length, 10);
                    for (const card of cards) {
                        assert.ok(card.frame.x >= 16 - 0.5);
                        assert.ok(card.frame.x + card.frame.width <= device.panelWidth - 16 + 0.5);
                        assert.ok(card.frame.height >= 44);
                        const texts = findAll(card, isText);
                        for (const text of texts) {
                            assert.ok(!text.textInfo.clippedVertically, `${text.text} fits vertically`);
                            assert.ok(!text.textInfo.squeezed, `${text.text} has readable width`);
                            assert.ok(contains(card.frame, text.frame, 1));
                            assert.equal(clippingAncestor(text), null);
                        }
                        const isPreview = ['热歌榜', '更多热歌'].includes(card.props.accessibilityLabel);
                        if (isPreview) {
                            assert.ok(Math.abs(card.frame.width - (device.panelWidth - 32)) < 1);
                            const cover = findAll(card, node => node.type === 'Image')[0];
                            assert.ok(contains(card.frame, cover.frame, 1));
                            for (const text of texts) {
                                assert.ok(text.frame.x + text.frame.width + 10 <= cover.frame.x);
                            }
                        } else {
                            assert.ok(Math.abs(card.frame.width - card.frame.height) < 1, 'tile stays square');
                        }
                    }
                    // 普通手机三列；测量窄面板时不能仍按整个窗口宽度排。
                    if (device.width < device.height) {
                        assert.ok(Math.abs(cards[1].frame.y - cards[3].frame.y) < 1);
                        assert.ok(cards[4].frame.y >= cards[1].frame.y + cards[1].frame.height + 10);
                    }
                    for (let i = 0; i < cards.length; i++) {
                        for (const next of cards.slice(i + 1)) {
                            const a = cards[i].frame;
                            const b = next.frame;
                            const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
                            const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
                            assert.ok(overlapX <= 0.5 || overlapY <= 0.5, 'cards do not overlap');
                        }
                    }
                } finally {
                    unmount();
                }
            });
        }
    }
}

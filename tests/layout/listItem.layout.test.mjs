// 列表行（ListItem）里的图标按钮：点击区域占满整行的高度。
// 歌曲行的「更多」、下载列表的暂停／继续／重试／删除、歌词预览、本地目录操作都用
// ListItem.ListItemIcon。行改成最小高度（随文字变高）以后，按钮的可点击区域缩成了
// 图标那么大（22 dp），点图标上下会点到整行、开始播放。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    createModuleLoader,
    describeFrame,
    findAll,
    findOne,
    renderLayout,
} from './harness.mjs';
import {createCommonStubs, createEnv} from './stubs.mjs';

const h = React.createElement;
const MIN_TOUCH = 44;

function renderRow(env, {heightType, rowStyle}) {
    const loader = createModuleLoader(createCommonStubs(env));
    const ListItem = loader.load('@/components/base/listItem').default;
    const {FontScaleScope} = loader.load('@/components/base/fontScaleScope');
    const rpx = loader.load('@/utils/rpx').default;
    const row = h(
        ListItem,
        {heightType, style: rowStyle, withHorizontalPadding: true, onPress() {}},
        h(ListItem.Content, {title: '一首名字很长很长的歌', description: '歌手 - 专辑'}),
        // 歌曲行的「更多」：只在左右放宽点击范围
        h(ListItem.ListItemIcon, {
            width: rpx(48),
            hitSlop: {left: rpx(24), right: rpx(24)},
            position: 'none',
            icon: 'ellipsis-vertical',
            accessibilityLabel: 'more',
            onPress() {},
        }),
        // 下载列表的暂停、删除，本地目录的隐藏等：图标靠右，左边留 16 的间距
        h(ListItem.ListItemIcon, {
            icon: 'trash-outline',
            position: 'right',
            accessibilityLabel: 'delete',
            onPress() {},
        }),
    );
    return renderLayout(h(FontScaleScope, {followSystem: true}, row), {
        env,
        width: env.window.width,
        height: env.window.height,
    });
}

const ROWS = [
    {name: 'fixed-height row', heightType: 'big'},
    // 歌曲行现在的样子：只有最小高度，文字放大时跟着变高
    {name: 'min-height row', heightType: 'none', rowStyle: {minHeight: 64}},
];

for (const row of ROWS) {
    for (const fontScale of [1, 2]) {
        test(`icon buttons fill the ${row.name}, font scale ${fontScale}`, () => {
            const env = createEnv({width: 363, height: 806, fontScale});
            const {root, unmount} = renderRow(env, row);
            try {
                const listRow = findAll(root, record => record.props.accessibilityRole === 'button')[0];
                for (const label of ['more', 'delete']) {
                    const button = findOne(root, record => record.props.accessibilityLabel === label, label);
                    const [icon] = findAll(button, record => record.props.name !== undefined && record !== button);
                    const slop = button.props.hitSlop ?? {};
                    const touchWidth = button.frame.width + (slop.left ?? 0) + (slop.right ?? 0);
                    const touchHeight = button.frame.height + (slop.top ?? 0) + (slop.bottom ?? 0);
                    // 点击区域是整行的高度
                    assert.ok(
                        Math.abs(button.frame.y - listRow.frame.y) <= 0.5 &&
                            Math.abs(button.frame.height - listRow.frame.height) <= 0.5,
                        `${label} ${describeFrame(button.frame)} spans the row ${describeFrame(listRow.frame)}`,
                    );
                    assert.ok(touchHeight >= MIN_TOUCH - 0.5, `${label} is ${touchHeight.toFixed(1)} dp tall to touch`);
                    // 宽度：图标连同左右的间距都能点；「更多」靠 hitSlop 放宽到 44 以上
                    assert.ok(touchWidth >= icon.frame.width + (label === 'delete' ? 16 : 0) - 0.5, `${label} keeps its spacing inside the touch area`);
                    if (label === 'more') {
                        assert.ok(touchWidth >= MIN_TOUCH - 0.5, `more is ${touchWidth.toFixed(1)} dp wide to touch`);
                    }
                    // 图标在点击区域里竖直居中
                    const iconCenter = icon.frame.y + icon.frame.height / 2;
                    const buttonCenter = button.frame.y + button.frame.height / 2;
                    assert.ok(Math.abs(iconCenter - buttonCenter) <= 0.5, `${label} icon is centred`);
                }
            } finally {
                unmount();
            }
        });
    }
}

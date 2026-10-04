// 推荐歌单页（标题栏、音源标签、分类标签条、歌单网格、列表首尾的提示）和点第一个
// 分类标签弹出的「歌单类别」面板：按 1、1.3、1.5、2 倍系统字体排版，文字不被裁掉、
// 不挤成一条缝，控件之间不互相压住。
// 以前分类标签条是固定高度，大字体时标签的上下被裁掉；音源标签是固定宽度、名字却
// 跟着系统字体放大，字体稍大一点五个字的音源名就只剩三四个字。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    byText,
    clippingAncestor,
    contains,
    createModuleLoader,
    describeFrame,
    findAll,
    findOne,
    flattenStyle,
    isText,
    renderLayout,
    strictStub,
} from './harness.mjs';
import {
    FlashListGrid,
    createCommonStubs,
    createEnv,
    createTabViewStub,
    inAppFontScaleScope,
} from './stubs.mjs';

const h = React.createElement;
const PAGE_MARGIN = 16;

const PLUGINS = [
    {hash: 'netease', name: '网易云音乐'},
    {hash: 'qq', name: 'QQ音乐'},
    {hash: 'kugou', name: '酷狗'},
    {hash: 'bili', name: 'Bilibili'},
    // 特别长的名字在标签里截断，不把标签撑宽
    {hash: 'long', name: '一个名字特别长的自建音源（备用线路）'},
];
const LONG_PLUGIN_NAME = PLUGINS[PLUGINS.length - 1].name;

const PINNED_TAGS = [
    {id: 'chinese', title: '华语'},
    {id: 'pop', title: '流行'},
    {id: 'night', title: 'Late Night'},
    {id: 'nineties', title: '八九十年代经典老歌'},
];

const TAG_GROUPS = [
    {
        title: '语种',
        data: ['华语', '欧美', '日语', '韩语', '粤语'].map(title => ({id: title, title})),
    },
    {
        title: 'Mood & Scene',
        data: ['Late Night', 'Study / Focus', '跑步', '助眠'].map(title => ({id: title, title})),
    },
    {
        title: '一个很长的分组名称：年代、经典与怀旧金曲',
        data: [
            {id: 'nineties', title: '八九十年代经典老歌'},
            {id: 'long', title: 'A very long tag title that cannot fit on one line at large font sizes'},
            // 没有名字的标签显示「未知名称」
            {id: 'untitled', title: ''},
        ],
    },
    // 没有分组名
    {data: [{id: 'other', title: '其他'}, {id: 'acg', title: 'ACG'}]},
];

const SHEETS = [
    {id: '1', title: '华语经典：那些年我们一起听过的歌', artwork: 'a'},
    {id: '2', title: 'Late Night Lo-Fi Beats to Study and Relax', artwork: 'b'},
    {id: '3', title: '纯音乐', artwork: 'c'},
    {id: '4', title: '粤语金曲 · 八九十年代', artwork: 'd'},
    {id: '5', title: '', artwork: 'e'},
    {id: '6', title: 'K-POP 2026 年度榜单 TOP 100 完整版', artwork: 'f'},
    {id: '7', title: '跑步', artwork: 'g'},
].map(sheet => ({...sheet, platform: '测试源'}));

const DEVICES = [
    {name: '320×640', width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {name: "the user's phone 363×806", width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
    {name: 'landscape 806×363', width: 806, height: 363, scale: 3.5, insets: {top: 0, right: 24, bottom: 20, left: 24}},
];
const LANGUAGES = ['zh-CN', 'en-US'];
const FONT_SCALES = [1, 1.3, 1.5, 2];

/** 推荐歌单页没有标签栏：正在播放时迷你播放器浮在页面底部，用生产的规则和尺寸算 */
function musicBarLayout(loader) {
    const {resolveMusicBarLayout} = loader.load('@/components/musicBar/layoutPolicy');
    const sizes = loader.load('@/components/musicBar/layout');
    return resolveMusicBarLayout({
        routeSupportsMusicBar: true,
        routeHasTabBar: false,
        hasCurrentMusic: true,
        keyboardVisible: false,
        barHeight: sizes.MUSIC_BAR_HEIGHT,
        floatingBottom: sizes.MUSIC_BAR_FLOATING_BOTTOM,
        tabBarHeight: sizes.TAB_BAR_HEIGHT,
        tabBarGap: sizes.MUSIC_BAR_TAB_BAR_GAP,
    });
}

function createPageStubs(env, {plugins, sheets, state, loaderRef}) {
    const requestState = () =>
        loaderRef.current.load('@/constants/commonConst').RequestStateCode[state];
    return {
        ...createCommonStubs(env),
        '@react-navigation/native': strictStub('@react-navigation/native', {
            useNavigation: () => ({goBack() {}}),
            useTheme: () => ({dark: false}),
        }),
        '@/core/theme': strictStub('@/core/theme', {
            default: {useTheme: () => ({dark: false})},
        }),
        // 标题栏的弹出菜单画在根视图的浮层里，不在页面的排版里
        '@/components/base/portal': strictStub('portal', {default: () => null}),
        '@/core/router': strictStub('@/core/router', {
            ROUTE_PATH: new Proxy({}, {get: (_, key) => String(key)}),
            useNavigate: () => () => {},
            useParams: () => ({}),
        }),
        '@/core/pluginManager': strictStub('@/core/pluginManager', {
            default: {getSortedPluginsWithAbility: () => plugins},
        }),
        'react-native-tab-view': createTabViewStub(),
        '@shopify/flash-list': strictStub('@shopify/flash-list', {FlashList: FlashListGrid}),
        '@/pages/recommendSheets/hooks/useRecommendListTags': strictStub(
            'useRecommendListTags',
            {default: () => ({pinned: PINNED_TAGS, data: TAG_GROUPS})},
        ),
        '@/pages/recommendSheets/hooks/useRecommendSheets': strictStub(
            'useRecommendSheets',
            {default: () => [() => {}, sheets, requestState()]},
        ),
        // 真实的 useMusicBarFloatingOffset 读这份布局状态
        '@/components/musicBar/layoutState': strictStub('musicBarLayoutState', {
            useMusicBarLayoutState: () => ({layout: musicBarLayout(loaderRef.current)}),
        }),
    };
}

/**
 * @param {'FINISHED' | 'ERROR'} options.state 歌单列表的请求状态
 */
function renderPage(env, {plugins = PLUGINS, sheets = SHEETS, state = 'FINISHED'} = {}) {
    const loaderRef = {current: null};
    const loader = createModuleLoader(
        createPageStubs(env, {plugins, sheets, state, loaderRef}),
    );
    loaderRef.current = loader;
    const RecommendSheets = loader.load('@/pages/recommendSheets').default;
    const rendered = renderLayout(
        inAppFontScaleScope(loader, {route: 'recommend-sheets'}, h(RecommendSheets)),
        {env, width: env.window.width, height: env.window.height},
    );
    return {
        ...rendered,
        t: loader.load('@/core/i18n').default.t,
        fontSizes: loader.load('@/constants/uiConst').fontSizeConst,
        musicBar: musicBarLayout(loader),
    };
}

/** 页面的安全区（ShortcutPageSurface 四边都让开） */
function safeArea(device) {
    return {
        left: device.insets.left,
        right: device.width - device.insets.right,
        top: device.insets.top,
        bottom: device.height - device.insets.bottom,
    };
}

/**
 * 竖直方向上把 record 裁掉一部分的祖先。横向滚动的内容左右本来就会滚出屏幕，
 * 只看上下：overflow 不是 visible 的视图、横向滚动容器都会裁掉超出上下边的部分。
 */
function verticalClipper(record) {
    for (let ancestor = record.parent; ancestor; ancestor = ancestor.parent) {
        const overflow = flattenStyle(ancestor.props.style).overflow;
        const clips =
            overflow === 'hidden' ||
            overflow === 'scroll' ||
            (ancestor.type === 'ScrollView' && ancestor.scroll === 'horizontal');
        if (
            clips &&
            (record.frame.y < ancestor.frame.y - 0.5 ||
                record.frame.y + record.frame.height >
                    ancestor.frame.y + ancestor.frame.height + 0.5)
        ) {
            return ancestor;
        }
    }
    return null;
}

function assertReadable(text, what) {
    assert.ok(text, `${what} is rendered`);
    assert.ok(!text.textInfo.clippedVertically, `${what} is not cut off: ${describeFrame(text.frame)}`);
    assert.ok(!text.textInfo.squeezed, `${what} has room: ${describeFrame(text.frame)}`);
}

function ancestorOf(record, predicate) {
    for (let ancestor = record.parent; ancestor; ancestor = ancestor.parent) {
        if (predicate(ancestor)) {
            return ancestor;
        }
    }
    return null;
}

const bottomOf = frame => frame.y + frame.height;
const rightOf = frame => frame.x + frame.width;

for (const device of DEVICES) {
    for (const language of LANGUAGES) {
        for (const fontScale of FONT_SCALES) {
            const where = `${device.name}, ${language}, font scale ${fontScale}`;

            test(`recommended sheets page on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, fontSizes, musicBar} = renderPage(env);
                const area = safeArea(device);
                try {
                    // 标题栏：标题一行完整显示，不出标题栏，不压到返回按钮
                    const title = findOne(root, byText(t('recommendSheet.title')), 'page title');
                    // 这一页登记过（fontScaleMigration），ThemeText 跟随系统字体
                    assert.equal(title.metrics.fontSize, fontSizes.appbar * fontScale, 'the page follows the system font');
                    assertReadable(title, 'page title');
                    assert.ok(!title.textInfo.truncated, 'page title is shown in full');
                    assert.ok(contains(title.parent.frame, title.frame, 1), 'title stays in the app bar');
                    const back = findOne(root, record => record.props.accessibilityLabel === 'back', 'back button');
                    assert.ok(back.frame.x >= area.left - 0.5);
                    assert.ok(rightOf(back.frame) <= title.frame.x + 0.5, 'title does not cover the back button');

                    // 音源标签：一样宽、至少 48 高；普通长度的名字选中、未选中都完整显示，
                    // 特别长的名字截断成一行
                    const tabs = findAll(root, record => record.props.accessibilityRole === 'tab');
                    assert.deepEqual(tabs.map(tab => tab.props.accessibilityLabel), PLUGINS.map(plugin => plugin.name));
                    for (const tab of tabs) {
                        const name = tab.props.accessibilityLabel;
                        assert.ok(tab.frame.height >= 48 - 0.5, `tab ${name} is at least 48 dp tall`);
                        assert.ok(
                            Math.abs(tab.frame.width - tabs[0].frame.width) <= 0.5,
                            `tab ${name} ${describeFrame(tab.frame)} is as wide as the others ${describeFrame(tabs[0].frame)}`,
                        );
                        const labels = findAll(tab, isText);
                        assert.equal(labels.length, 2, 'unfocused and focused copies of the label');
                        for (const label of labels) {
                            assertReadable(label, `tab label ${name}`);
                            assert.equal(label.textInfo.shownLines, 1);
                            assert.equal(
                                label.textInfo.truncated,
                                name === LONG_PLUGIN_NAME,
                                name === LONG_PLUGIN_NAME
                                    ? 'the long name is cut short'
                                    : `tab label ${name} (${label.props.style.fontWeight}) is shown in full`,
                            );
                            assert.ok(contains(tab.frame, label.frame, 1), `label ${name} stays in its tab`);
                            assert.equal(verticalClipper(label), null, `label ${name} is not cut off`);
                        }
                    }
                    const tabBarBottom = Math.max(...tabs.map(tab => bottomOf(tab.frame)));

                    // 分类标签条：在音源标签下面，标签上下不被裁掉，第一个标签和网格左对齐
                    const defaultTag = findOne(root, byText(t('common.default')), 'default tag');
                    const strip = ancestorOf(defaultTag, record => record.type === 'ScrollView');
                    assert.equal(strip.scroll, 'horizontal');
                    assert.ok(strip.frame.y >= tabBarBottom - 0.5, 'tag strip is below the source tabs');
                    const tagTexts = [defaultTag, ...PINNED_TAGS.map(tag => findOne(strip, byText(tag.title), `tag ${tag.title}`))];
                    for (const text of tagTexts) {
                        assertReadable(text, `tag ${text.text}`);
                        assert.equal(text.textInfo.shownLines, 1, `tag ${text.text} stays on one line`);
                        const tagBox = text.parent;
                        assert.ok(contains(tagBox.frame, text.frame, 1), `tag ${text.text} fits its chip`);
                        assert.equal(verticalClipper(tagBox), null, `tag ${text.text} ${describeFrame(tagBox.frame)} is not cut off`);
                    }
                    assert.ok(
                        Math.abs(defaultTag.parent.frame.x - (area.left + PAGE_MARGIN)) <= 0.5,
                        `first tag starts at the page margin, x=${defaultTag.parent.frame.x}`,
                    );

                    // 歌单网格：在标签条下面；标题最多两行、不出封面的左右；上一行的标题不压到下一行
                    const covers = findAll(root, record => record.type === 'Image');
                    assert.equal(covers.length, SHEETS.length);
                    const tiles = covers.map(cover => {
                        const texts = findAll(cover.parent, isText);
                        assert.equal(texts.length, 1);
                        return {cover, title: texts[0]};
                    });
                    for (const {cover, title: sheetTitle} of tiles) {
                        assert.ok(cover.frame.y >= bottomOf(strip.frame) - 0.5, 'grid starts below the tag strip');
                        assert.ok(cover.frame.x >= area.left + PAGE_MARGIN - 0.5);
                        assert.ok(rightOf(cover.frame) <= area.right - PAGE_MARGIN + 0.5);
                        assertReadable(sheetTitle, `sheet title "${sheetTitle.text}"`);
                        assert.ok(sheetTitle.textInfo.shownLines <= 2);
                        assert.ok(sheetTitle.frame.y >= bottomOf(cover.frame) - 0.5);
                        assert.ok(
                            sheetTitle.frame.x >= cover.frame.x - 0.5 &&
                                rightOf(sheetTitle.frame) <= rightOf(cover.frame) + 1,
                            `"${sheetTitle.text}" stays within its cover`,
                        );
                        assert.equal(clippingAncestor(sheetTitle), null, `"${sheetTitle.text}" is not clipped`);
                    }
                    for (const a of tiles) {
                        for (const b of tiles) {
                            if (b.cover.frame.y > a.cover.frame.y + 0.5) {
                                assert.ok(
                                    bottomOf(a.title.frame) <= b.cover.frame.y + 0.5,
                                    `"${a.title.text}" does not run into the row below`,
                                );
                            }
                        }
                    }

                    // 列表末尾的提示完整显示；滚到底时最后一行露在迷你播放器上面
                    const footer = findOne(root, byText(t('common.listReachEnd')), 'end of list');
                    assertReadable(footer, 'end of list');
                    assert.ok(contains(footer.parent.frame, footer.frame, 1), 'end-of-list text fits its footer');
                    let content = footer.parent;
                    while (content.type !== 'ScrollContent') {
                        content = content.parent;
                    }
                    const lastBottom = Math.max(...tiles.map(tile => bottomOf(tile.title.frame)));
                    const spaceBelowLast = bottomOf(content.frame) - lastBottom;
                    assert.ok(
                        spaceBelowLast >= musicBar.reservedBottom - 0.5,
                        `only ${spaceBelowLast.toFixed(1)} dp below the last row; the mini player needs ${musicBar.reservedBottom}`,
                    );
                } finally {
                    unmount();
                }
            });

            test(`recommended sheets page that failed to load more, ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t} = renderPage(env, {state: 'ERROR'});
                try {
                    const footer = findOne(
                        root,
                        record => isText(record) && record.text.startsWith(t('common.failToLoad')),
                        'load-more error',
                    );
                    assertReadable(footer, 'load-more error');
                    const wrapper = ancestorOf(footer, record => record.type === 'View' && flattenStyle(record.props.style).width === '100%');
                    assert.ok(contains(wrapper.frame, footer.frame, 1), `load-more error ${describeFrame(footer.frame)} fits its footer ${describeFrame(wrapper.frame)}`);
                    assert.equal(clippingAncestor(footer), null);
                } finally {
                    unmount();
                }
            });

            test(`recommended sheets page with nothing loaded (error), ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t} = renderPage(env, {sheets: [], state: 'ERROR'});
                const area = safeArea(device);
                try {
                    const strip = ancestorOf(findOne(root, byText(t('common.default')), 'default tag'), record => record.type === 'ScrollView');
                    for (const key of ['common.error', 'common.clickToRetry']) {
                        const text = findOne(root, byText(t(key)), key);
                        assertReadable(text, key);
                        assert.ok(text.frame.y >= bottomOf(strip.frame) - 0.5, `${key} is below the tag strip`);
                        assert.ok(text.frame.x >= area.left - 0.5 && rightOf(text.frame) <= area.right + 1, `${key} stays on screen`);
                        assert.equal(clippingAncestor(text), null, `${key} is not clipped`);
                    }
                    const retry = findOne(root, byText(t('common.clickToRetry')), 'retry');
                    assert.ok(contains(retry.parent.frame, retry.frame, 1), 'retry text fits its button');
                } finally {
                    unmount();
                }
            });

            test(`recommended sheets page without plugins, ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t} = renderPage(env, {plugins: []});
                const area = safeArea(device);
                try {
                    const texts = [
                        findOne(root, byText(t('noPlugin.titleWithType', {type: t('recommendSheet.title')})), 'no-plugin title'),
                        findOne(root, byText(t('noPlugin.description')), 'no-plugin description'),
                    ];
                    for (const text of texts) {
                        assertReadable(text, `"${text.text}"`);
                        assert.ok(
                            text.frame.x >= area.left + PAGE_MARGIN - 0.5 &&
                                rightOf(text.frame) <= area.right - PAGE_MARGIN + 1,
                            `"${text.text}" ${describeFrame(text.frame)} keeps the page margins`,
                        );
                        assert.equal(clippingAncestor(text), null);
                    }
                    assert.ok(bottomOf(texts[0].frame) <= texts[1].frame.y + 0.5, 'description is below the title');
                    // 横屏也在页面正中
                    for (const text of texts) {
                        const offCenter = text.frame.x + text.frame.width / 2 - (area.left + area.right) / 2;
                        assert.ok(Math.abs(offCenter) <= 1, `"${text.text}" is centered (off by ${offCenter.toFixed(1)} dp)`);
                    }
                } finally {
                    unmount();
                }
            });

            test(`sheet tags panel on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const loader = createModuleLoader({
                    ...createCommonStubs(env),
                    '@/native/utils': strictStub('@/native/utils', {
                        default: {getWindowDimensions: () => env.window},
                    }),
                });
                const SheetTags = loader.load('@/components/panels/types/sheetTags').default;
                const {t} = loader.load('@/core/i18n').default;
                const fontSizes = loader.load('@/constants/uiConst').fontSizeConst;
                const {root, unmount} = renderLayout(
                    inAppFontScaleScope(loader, {panel: 'SheetTags'}, h(SheetTags, {tags: TAG_GROUPS, onTagPressed() {}})),
                    {env, width: env.window.width, height: env.window.height},
                );
                try {
                    const title = findOne(root, byText(t('panel.sheetTags.title')), 'panel title');
                    assert.equal(title.metrics.fontSize, fontSizes.title * fontScale, 'the panel follows the system font');
                    // 面板标题和其他面板一样只占一行，放不下时截断
                    assertReadable(title, 'panel title');
                    assert.equal(title.textInfo.shownLines, 1);

                    const scroll = findOne(root, record => record.type === 'ScrollView', 'tag list');
                    const style = flattenStyle(scroll.props.style);
                    const bounds = {
                        left: scroll.frame.x + style.paddingHorizontal,
                        right: rightOf(scroll.frame) - style.paddingHorizontal,
                    };
                    assert.ok(bottomOf(title.frame) <= scroll.frame.y + 0.5, 'tags start below the title');

                    const groupTitles = TAG_GROUPS.filter(group => group.title).map(group =>
                        findOne(scroll, byText(group.title), `group "${group.title}"`),
                    );
                    const tagTexts = [
                        t('common.default'),
                        ...TAG_GROUPS.flatMap(group => group.data.map(tag => tag.title || t('common.unknownName'))),
                    ].flatMap(text => findAll(scroll, byText(text)));
                    assert.equal(tagTexts.length, 1 + TAG_GROUPS.reduce((sum, group) => sum + group.data.length, 0));
                    for (const text of [...groupTitles, ...tagTexts]) {
                        assertReadable(text, `"${text.text}"`);
                        assert.equal(clippingAncestor(text), null, `"${text.text}" is not clipped`);
                    }
                    const chips = tagTexts.map(text => text.parent);
                    for (const chip of chips) {
                        assert.ok(
                            chip.frame.x >= bounds.left - 0.5 && rightOf(chip.frame) <= bounds.right + 0.5,
                            `chip ${describeFrame(chip.frame)} stays between x=${bounds.left} and x=${bounds.right}`,
                        );
                        assert.ok(contains(chip.frame, findAll(chip, isText)[0].frame, 1), 'tag text fits its chip');
                    }
                    for (let i = 0; i < chips.length; i += 1) {
                        for (const other of chips.slice(i + 1)) {
                            const a = chips[i].frame;
                            const b = other.frame;
                            const overlapX = Math.min(rightOf(a), rightOf(b)) - Math.max(a.x, b.x);
                            const overlapY = Math.min(bottomOf(a), bottomOf(b)) - Math.max(a.y, b.y);
                            assert.ok(overlapX <= 0.5 || overlapY <= 0.5, `chips ${describeFrame(a)} and ${describeFrame(b)} do not overlap`);
                        }
                    }
                    for (const groupTitle of groupTitles) {
                        assert.ok(
                            groupTitle.frame.x >= bounds.left - 0.5 && rightOf(groupTitle.frame) <= bounds.right + 1,
                            `group "${groupTitle.text}" stays inside the panel`,
                        );
                        for (const chip of chips) {
                            const overlapY = Math.min(bottomOf(chip.frame), bottomOf(groupTitle.frame)) - Math.max(chip.frame.y, groupTitle.frame.y);
                            assert.ok(overlapY <= 0.5, `group "${groupTitle.text}" does not overlap a tag`);
                        }
                    }
                } finally {
                    unmount();
                }
            });
        }
    }
}

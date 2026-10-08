// 插件管理和关于两页：iOS 分组列表的行要完整显示、点得到，不被迷你播放器挡住。
//
// 插件管理：以前常用的入口藏在右上角的 ⋮ 菜单（订阅设置、排序、LX 自定义源、诊断、
// 卸载全部）和右下角的悬浮按钮（安装、更新）里，现在右上角只留安装用的 +，其余直接
// 放在页面上。关于：以前整页是上游作者猫头猫的介绍和联系方式，现在讲这个修改版，
// 只在致谢里提一句基于猫头猫的 MusicFree。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    assertReadable,
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
import {FlashListGrid, createEnv, createPageStubs, pageMusicBarLayout} from './stubs.mjs';

const h = React.createElement;
const noop = () => {};

const DEVICES = [
    {name: '320×640', width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {name: "the user's phone 363×806", width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
    {name: 'landscape 806×363', width: 806, height: 363, scale: 3.5, insets: {top: 0, right: 24, bottom: 20, left: 24}},
];
const LANGUAGES = ['zh-CN', 'en-US'];
const CARD_MARGIN = 16;
const MIN_ROW_HEIGHT = 44;

const rightOf = frame => frame.x + frame.width;
const bottomOf = frame => frame.y + frame.height;
const byLabel = label => record => record.props.accessibilityLabel === label;
const isButton = record => record.props.accessibilityRole === 'button' && typeof record.props.onPress === 'function';

function insideButton(record) {
    for (let ancestor = record.parent; ancestor; ancestor = ancestor.parent) {
        if (isButton(ancestor)) {
            return true;
        }
    }
    return false;
}

/** 点得到的范围：按钮本身加上 hitSlop */
function touchFrame(button) {
    const slop = button.props.hitSlop ?? {};
    const left = typeof slop === 'number' ? slop : slop.left ?? 0;
    const top = typeof slop === 'number' ? slop : slop.top ?? 0;
    const right = typeof slop === 'number' ? slop : slop.right ?? 0;
    const bottom = typeof slop === 'number' ? slop : slop.bottom ?? 0;
    return {
        x: button.frame.x - left,
        y: button.frame.y - top,
        width: button.frame.width + left + right,
        height: button.frame.height + top + bottom,
    };
}

/** 页面内容的左右边界（setting 页外层的 HorizontalSafeAreaView 让开左右安全区） */
function contentEdges(device) {
    return {left: device.insets.left, right: device.width - device.insets.right};
}

/** 分组卡片里的一行：在卡片的左右边距之内，至少 44 高，里面的文字完整显示 */
function assertGroupedRow(row, device, what) {
    const edges = contentEdges(device);
    assert.ok(row.frame.height >= MIN_ROW_HEIGHT - 0.5, `${what} is at least ${MIN_ROW_HEIGHT} dp tall: ${describeFrame(row.frame)}`);
    assert.ok(row.frame.x >= edges.left + CARD_MARGIN - 0.5, `${what} keeps the card margin on the left: ${describeFrame(row.frame)}`);
    assert.ok(rightOf(row.frame) <= edges.right - CARD_MARGIN + 0.5, `${what} keeps the card margin on the right: ${describeFrame(row.frame)}`);
    assert.equal(clippingAncestor(row), null, `${what} is not cut off`);
    for (const text of findAll(row, isText)) {
        assertReadable(text, `${what}: "${text.text}"`);
        assert.ok(!text.textInfo.truncated, `${what}: "${text.text}" is shown in full`);
        assert.ok(contains(row.frame, text.frame, 1), `${what}: "${text.text}" stays in the row`);
    }
}

/** 滚动内容的底部留白至少盖过迷你播放器占的高度，最后一行能滚到它上面 */
function assertClearsMusicBar(root, musicBar) {
    const scrollViews = findAll(root, record => record.type === 'ScrollView');
    const padded = scrollViews.some(scrollView => {
        const own = flattenStyle(scrollView.props.contentContainerStyle).paddingBottom ?? 0;
        const footer = findAll(scrollView, record => (flattenStyle(record.props.style).paddingBottom ?? 0) >= musicBar.reservedBottom);
        return own >= musicBar.reservedBottom || footer.length > 0;
    });
    assert.ok(padded, `the list ends ${musicBar.reservedBottom} dp or more above the bottom so the mini player does not cover it`);
}

// ---------------------------------------------------------------------------
// 插件管理
// ---------------------------------------------------------------------------

const PLUGINS = [
    {hash: 'kuwo', name: '酷我音乐'},
    {hash: 'netease', name: '温网易'},
    {hash: 'long', name: 'A plugin with a rather long English name'},
];

function renderPluginList(env, plugins) {
    const navigated = [];
    const panels = [];
    const stubs = {
        ...createPageStubs(env),
        '@react-navigation/native': strictStub('@react-navigation/native', {
            useNavigation: () => ({goBack: noop, navigate: route => navigated.push(route)}),
            useTheme: () => ({dark: false}),
        }),
        '@/components/base/statusBar': strictStub('statusBar', {default: () => null}),
        '@/components/base/loading': strictStub('loading', {default: () => null}),
        '@shopify/flash-list': strictStub('@shopify/flash-list', {FlashList: FlashListGrid}),
        'expo-document-picker': strictStub('expo-document-picker', {getDocumentAsync: async () => ({canceled: true})}),
        '@react-native-clipboard/clipboard': strictStub('clipboard', {default: {setString: noop}}),
        '@/components/dialogs/useDialog': strictStub('dialogs', {showDialog: noop}),
        '@/components/panels/usePanel': strictStub('@/components/panels/usePanel', {
            showPanel: (name, payload) => panels.push({name, payload}),
            hidePanel: noop,
            panelInfoStore: {setValue: noop, getValue: () => ({})},
        }),
        '@/core/pluginManager': strictStub('@/core/pluginManager', {
            default: {getEnabledPlugins: () => [], uninstallAllPlugins: async () => {}},
            useSortedPlugins: () => plugins,
        }),
        '@/core/pluginManager/diagnostics': strictStub('diagnostics', {
            buildPluginDiagnosticReport: () => '',
            clearPluginDiagnosticEvents: () => 0,
            getRecentPluginDiagnosticErrors: () => [],
        }),
        '@/pages/setting/settingTypes/pluginSetting/installPluginUtils': strictStub('installPluginUtils', {
            createPluginInstaller: noop,
            formatPluginInstallResult: () => '',
            installPluginFromUrlText: async () => [],
            installPluginsFromUrlTexts: async () => [],
            runPluginInstallBatchWithCapabilityApproval: async () => [],
            showPluginInstallResults: noop,
        }),
        // 插件卡片另有测试；这里只要一张有高度的卡片占位
        '@/pages/setting/settingTypes/pluginSetting/components/pluginItem': strictStub('pluginItem', {
            default: ({plugin}) => h('View', {testID: `plugin-card-${plugin.hash}`, style: {height: 180, marginHorizontal: CARD_MARGIN, marginVertical: 6}}),
        }),
    };
    const loader = createModuleLoader(stubs);
    const PluginList = loader.load('@/pages/setting/settingTypes/pluginSetting/views/pluginList').default;
    // setting 路由没有登记字体迁移（fontScaleMigration），ThemeText 不跟随系统字体
    const rendered = renderLayout(h(PluginList), {env, width: env.window.width, height: env.window.height});
    return {...rendered, t: loader.load('@/core/i18n').default.t, navigated, panels};
}

for (const device of DEVICES) {
    for (const language of LANGUAGES) {
        const where = `${device.name}, ${language}`;

        test(`plugin management shows its actions on the page, ${where}`, () => {
            const env = createEnv({...device, language});
            const {root, unmount, t, navigated, panels} = renderPluginList(env, PLUGINS);
            try {
                // 右上角只有安装用的 +，没有 ⋮ 菜单
                assert.equal(findAll(root, byLabel('ellipsis-vertical')).length, 0, 'no ⋮ menu in the app bar');
                const install = findOne(root, byLabel(t('pluginSetting.menu.installPlugin')), 'install button');
                const installTouch = touchFrame(install);
                assert.ok(installTouch.width >= MIN_ROW_HEIGHT - 0.5 && installTouch.height >= MIN_ROW_HEIGHT - 0.5,
                    `install button is easy to hit: ${describeFrame(installTouch)}`);
                assert.ok(rightOf(install.frame) <= contentEdges(device).right + 0.5, 'install button stays on screen');
                install.props.onPress();
                assert.deepEqual(
                    panels.at(-1).payload.candidates.map(candidate => candidate.title),
                    [
                        t('pluginSetting.fabOptions.installFromLocal'),
                        t('pluginSetting.fabOptions.installFromNetwork'),
                        t('pluginSetting.fabOptions.importLxSource'),
                    ],
                    '+ offers the three ways to install',
                );

                // 上面两组：订阅设置、排序、LX 自定义源；更新订阅、更新全部插件
                const headerTitles = [
                    t('pluginSetting.menu.subscriptionSetting'),
                    t('pluginSetting.menu.sort'),
                    t('lxSource.title'),
                    t('pluginSetting.fabOptions.updateSubscription'),
                    t('pluginSetting.fabOptions.updateAllPlugins'),
                ];
                const headerRows = headerTitles.map(title => findOne(root, record => isButton(record) && record.props.accessibilityLabel === title, title));
                headerRows.forEach((row, index) => {
                    assertGroupedRow(row, device, headerTitles[index]);
                    if (index > 0) {
                        assert.ok(row.frame.y >= bottomOf(headerRows[index - 1].frame) - 0.5, `${headerTitles[index]} comes after ${headerTitles[index - 1]}`);
                    }
                });
                headerRows[0].props.onPress();
                headerRows[1].props.onPress();
                headerRows[2].props.onPress();
                assert.deepEqual(navigated, ['/pluginsetting/subscribe', '/pluginsetting/sort', '/pluginsetting/lx-source']);

                const updateFooter = findOne(root, record => isText(record) && record.text === t('pluginSetting.updateFooter'), 'update footer');
                assertReadable(updateFooter, 'update footer');
                assert.ok(!updateFooter.textInfo.truncated, 'update footer is shown in full');

                // 已安装的插件：标题在第一张卡片上面，卡片按顺序排在两组入口下面
                const installedTitle = findOne(root, record => isText(record) && record.text === t('pluginSetting.section.installed'), 'installed title');
                assertReadable(installedTitle, 'installed title');
                const cards = PLUGINS.map(plugin => findOne(root, record => record.props.testID === `plugin-card-${plugin.hash}`, plugin.name));
                assert.ok(installedTitle.frame.y >= bottomOf(updateFooter.frame) - 0.5, 'installed plugins come after the update section');
                assert.ok(cards[0].frame.y >= bottomOf(installedTitle.frame) - 0.5, 'the title sits above the first plugin');

                // 下面：诊断两行，最后是红色的卸载全部插件
                const footerTitles = [
                    t('pluginSetting.menu.copyDiagnostics'),
                    t('pluginSetting.menu.clearDiagnostics'),
                    t('pluginSetting.menu.uninstallAll'),
                ];
                const footerRows = footerTitles.map(title => findOne(root, record => isButton(record) && record.props.accessibilityLabel === title, title));
                assert.ok(footerRows[0].frame.y >= bottomOf(cards.at(-1).frame) - 0.5, 'diagnostics come after the plugins');
                footerRows.forEach((row, index) => assertGroupedRow(row, device, footerTitles[index]));
                assert.ok(footerRows[2].frame.y > bottomOf(footerRows[1].frame), 'uninstall all is in its own group');
                assertClearsMusicBar(root, pageMusicBarLayout());
            } finally {
                unmount();
            }
        });

        test(`plugin management without plugins says how to add one, ${where}`, () => {
            const env = createEnv({...device, language});
            const {root, unmount, t} = renderPluginList(env, []);
            try {
                const hint = findOne(root, record => isText(record) && record.text === t('pluginSetting.empty'), 'empty hint');
                assertReadable(hint, 'empty hint');
                assert.ok(!hint.textInfo.truncated, 'empty hint is shown in full');
                assert.ok(hint.frame.x >= contentEdges(device).left - 0.5 && rightOf(hint.frame) <= contentEdges(device).right + 0.5);
                assert.equal(findAll(root, record => isText(record) && record.text === t('pluginSetting.section.installed')).length, 0, 'no installed title without plugins');
                assert.equal(findAll(root, byLabel(t('pluginSetting.menu.uninstallAll'))).length, 0, 'nothing to uninstall');
                // 订阅设置这类入口没有插件时也在
                findOne(root, byLabel(t('pluginSetting.menu.subscriptionSetting')), 'subscription settings');
            } finally {
                unmount();
            }
        });
    }
}

// ---------------------------------------------------------------------------
// 关于
// ---------------------------------------------------------------------------

// 发布构建（v0.11.2）实际写进去的构建信息
const BUILD_INFO = {
    appVersion: '0.11.2',
    packageVersion: '0.11.2',
    versionCode: '400028',
    gitSha: '8cc3812df24e2972e6288e2ff555286f83d9b8c6',
    shortSha: '8cc3812',
    gitRef: 'feat/mpv-only',
    gitRefType: 'branch',
    buildRunUrl: 'https://github.com/CTZZG/MusicFree/actions/runs/37686770976',
    buildDate: '2026-10-07T21:41:36Z',
    signing: 'configured',
    node: 'v22.20.0',
    react: '19.2.3',
    reactNative: '0.85.3',
    expo: '56.0.8',
    player: 'mpv v0.41.0',
};

function renderAbout(env) {
    const opened = [];
    const stubs = {
        ...createPageStubs(env),
        '@react-native-clipboard/clipboard': strictStub('clipboard', {default: {setString: noop}}),
        'react-native-device-info': strictStub('react-native-device-info', {
            default: {getApplicationName: () => 'MusicFree', getVersion: () => '0.11.2', getBuildNumber: () => '400028'},
        }),
        '@/constants/buildInfo.generated': strictStub('buildInfo', {buildInfo: BUILD_INFO}),
        '@/hooks/useCheckUpdate': strictStub('useCheckUpdate', {checkUpdateAndShowResult: noop}),
        '@/utils/openUrl': strictStub('openUrl', {default: url => opened.push(url)}),
    };
    const loader = createModuleLoader(stubs);
    const AboutSetting = loader.load('@/pages/setting/settingTypes/aboutSetting').default;
    // 关于页在 setting 路由里：外层左右让开安全区，上面是 48 高的标题栏
    const page = h(
        'View',
        {style: {flex: 1, paddingTop: env.insets.top + 48, paddingLeft: env.insets.left, paddingRight: env.insets.right, paddingBottom: env.insets.bottom}},
        h(AboutSetting),
    );
    const rendered = renderLayout(page, {env, width: env.window.width, height: env.window.height});
    return {...rendered, t: loader.load('@/core/i18n').default.t, opened, links: loader.load('@/constants/projectLinks')};
}

for (const device of DEVICES) {
    for (const language of LANGUAGES) {
        test(`about page describes this version and credits MusicFree, ${device.name}, ${language}`, () => {
            const env = createEnv({...device, language});
            const {root, unmount, t, opened, links} = renderAbout(env);
            try {
                // 不再把上游作者写成这个版本的作者，也没有他的联系方式
                const texts = findAll(root, isText).map(text => text.text).join('\n');
                for (const upstreamContact of ['软件作者', '公众号', 'B站', '小红书', '开发者的话']) {
                    assert.ok(!texts.includes(upstreamContact), `no "${upstreamContact}" on the page`);
                }

                const name = findOne(root, record => isText(record) && record.text === 'MusicFree' && !insideButton(record), 'app name');
                const version = findOne(root, record => isText(record) && record.text === t('about.versionLine', {version: '0.11.2', build: '400028'}), 'version line');
                for (const [text, what] of [[name, 'app name'], [version, 'version line']]) {
                    assertReadable(text, what);
                    assert.ok(!text.textInfo.truncated, `${what} is shown in full`);
                }

                // 检查更新、历史版本、源代码指向这个仓库
                const rows = [
                    [t('about.checkUpdate'), null],
                    [`${t('about.releases')}，GitHub`, links.PROJECT_RELEASES_URL],
                    [`${t('about.sourceCode')}，GitHub`, links.PROJECT_URL],
                    [`MusicFree，${t('about.upstreamAuthor')}`, links.UPSTREAM_URL],
                    [t('about.build.run'), BUILD_INFO.buildRunUrl],
                    [t('about.build.copy'), null],
                ];
                for (const [label, url] of rows) {
                    const row = findOne(root, record => isButton(record) && record.props.accessibilityLabel === label, label);
                    assertGroupedRow(row, device, label);
                    if (url) {
                        row.props.onPress();
                        assert.equal(opened.at(-1), url, `${label} opens ${url}`);
                    }
                }
                assert.ok(!links.PROJECT_URL.includes('maotoumao') && links.UPSTREAM_URL.includes('maotoumao'));

                // 致谢下面写明是修改版、协议和不提供担保
                const notice = findOne(root, record => isText(record) && record.text === t('about.licenseNotice'), 'license notice');
                assertReadable(notice, 'license notice');
                assert.ok(!notice.textInfo.truncated, 'license notice is shown in full');

                // 构建信息：名称一行完整显示，值在右边，较长的值折行也不压到名称、不出卡片
                const edges = contentEdges(device);
                const infoLabels = ['version', 'commit', 'date', 'signing', 'player', 'runtime'].map(key => t(`about.build.${key}`));
                for (const label of infoLabels) {
                    const row = findOne(root, record => typeof record.props.accessibilityLabel === 'string' && record.props.accessibilityLabel.startsWith(`${label}，`) && record.props.accessible, label);
                    const [labelText, valueText] = findAll(row, isText);
                    assert.ok(row.frame.height >= MIN_ROW_HEIGHT - 0.5, `${label} row is tall enough`);
                    assert.ok(row.frame.x >= edges.left + CARD_MARGIN - 0.5 && rightOf(row.frame) <= edges.right - CARD_MARGIN + 0.5, `${label} row keeps the card margins`);
                    assertReadable(labelText, `${label} label`);
                    assert.equal(labelText.textInfo.shownLines, 1, `${label} label stays on one line`);
                    assert.ok(!labelText.textInfo.truncated, `${label} label is shown in full`);
                    assertReadable(valueText, `${label} value`);
                    assert.ok(!valueText.textInfo.truncated, `${label} value is shown in full`);
                    assert.ok(valueText.frame.x >= rightOf(labelText.frame) - 0.5, `${label} value does not overlap its label`);
                    assert.ok(contains(row.frame, valueText.frame, 1), `${label} value stays in its row`);
                }
                findOne(root, record => isText(record) && record.text === BUILD_INFO.player, 'player version');
                findOne(root, record => isText(record) && record.text === t('about.build.signed'), 'signed');

                const pluginNotice = findOne(root, record => isText(record) && record.text === t('about.pluginNotice'), 'plugin notice');
                assertReadable(pluginNotice, 'plugin notice');
                assert.ok(!pluginNotice.textInfo.truncated, 'plugin notice is shown in full');
                assertClearsMusicBar(root, pageMusicBarLayout());
            } finally {
                unmount();
            }
        });
    }
}

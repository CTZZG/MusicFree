// 歌曲行「更多」弹出的选项面板（MusicItemOptions）和「加入歌单」面板
// （AddToMusicSheet）：歌单、榜单、专辑详情里点出来的面板和页面一样跟随系统字体。
// 按 1、1.3、1.5、2 倍字体排版：歌名、歌手不被裁掉，选项、歌单行至少 44 高、互不重叠。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    assertReadable,
    byText,
    clippingAncestor,
    contains,
    createModuleLoader,
    describeFrame,
    findAll,
    findOne,
    isText,
    renderLayout,
    strictStub,
} from './harness.mjs';
import {createCommonStubs, createEnv, inAppFontScaleScope} from './stubs.mjs';

const h = React.createElement;

const MUSIC = {
    id: '1',
    platform: '网易云',
    title: '一首名字特别特别长的中文歌曲（2004 无与伦比演唱会现场版）',
    artist: '周杰伦',
    album: '2004 无与伦比演唱会 Live',
    artwork: 'cover',
};

const SHEETS = [
    {id: 'favorite', title: '我喜欢', worksNum: 128},
    {id: 'a', title: '通勤路上听的歌 · Morning Commute Mix', worksNum: 35, coverImg: 'a'},
    {id: 'b', title: '纯音乐', worksNum: 8},
];

const DEVICES = [
    {name: '320×640', width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {name: "the user's phone 363×806", width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
    {name: 'landscape 806×363', width: 806, height: 363, scale: 3.5, insets: {top: 0, right: 24, bottom: 20, left: 24}},
];

function noop() {}

function createPanelStubs(env) {
    return {
        ...createCommonStubs(env),
        '@/native/utils': strictStub('@/native/utils', {
            default: {getWindowDimensions: () => env.window},
        }),
        '@react-navigation/native': strictStub('@react-navigation/native', {
            useNavigation: () => ({navigate: noop, goBack: noop}),
        }),
        '@react-native-clipboard/clipboard': strictStub('clipboard', {default: {setString: noop}}),
        '@/components/dialogs/useDialog': strictStub('useDialog', {showDialog: noop}),
        '@/core/localMusicSheet': strictStub('@/core/localMusicSheet', {
            default: {
                useLocalMusic: () => null,
                useLocalFileExists: () => undefined,
                useIsHidden: () => false,
                removeMusic: noop,
            },
        }),
        '@/core/musicHistory': strictStub('@/core/musicHistory', {default: {removeMusic: noop}}),
        '@/core/dislikeMusic': strictStub('@/core/dislikeMusic', {
            default: {getMatchedRules: () => [], addRuleForMusic: noop, removeMatchedRules: noop},
        }),
        '@/core/trackPlayer': strictStub('@/core/trackPlayer', {
            default: {addNext: noop, addPlayLater: noop, play: noop},
        }),
        '@/core/mediaCache': strictStub('@/core/mediaCache', {
            default: {setMediaCache: noop, removeMediaCache: noop},
        }),
        '@/core/musicSheet': strictStub('@/core/musicSheet', {
            default: {addMusic: noop, removeMusic: noop},
            useSheetsBase: () => SHEETS,
        }),
        '@/core/downloader': strictStub('@/core/downloader', {default: {download: noop}}),
        '@/utils/mediaExtra': strictStub('@/utils/mediaExtra', {getMediaExtraProperty: () => undefined}),
        '@/core/lyricManager': strictStub('@/core/lyricManager', {default: {unassociateLyric: noop}}),
        '@/core/pluginManager': strictStub('@/core/pluginManager', {
            default: {
                getByMedia: () => ({supportedMethods: new Set(['getMusicComments']), instance: {}}),
            },
        }),
    };
}

/** @param {'MusicItemOptions' | 'AddToMusicSheet'} name */
function renderPanel(env, name, props) {
    const loader = createModuleLoader(createPanelStubs(env));
    const Panel = loader.load(
        name === 'MusicItemOptions'
            ? '@/components/panels/types/musicItemOptions'
            : '@/components/panels/types/addToMusicSheet',
    ).default;
    const rendered = renderLayout(inAppFontScaleScope(loader, {panel: name}, h(Panel, props)), {
        env,
        width: env.window.width,
        height: env.window.height,
    });
    return {
        ...rendered,
        t: loader.load('@/core/i18n').default.t,
        fontSizes: loader.load('@/constants/uiConst').fontSizeConst,
    };
}

const rightOf = frame => frame.x + frame.width;
const bottomOf = frame => frame.y + frame.height;

/** 每一行至少 44 高、互不重叠，行里的文字一行（可以截断）、不被裁、不出行 */
function assertRows(rows, what) {
    assert.ok(rows.length > 0, `${what} has rows`);
    for (const row of rows) {
        assert.ok(row.frame.height >= 44 - 0.5, `${what} row ${describeFrame(row.frame)} is at least 44 dp tall`);
        for (const text of findAll(row, isText)) {
            assertReadable(text, `"${text.text}"`);
            assert.ok(contains(row.frame, text.frame, 1), `"${text.text}" stays in its row`);
            assert.equal(clippingAncestor(text), null, `"${text.text}" is not clipped`);
        }
    }
    for (let i = 1; i < rows.length; i += 1) {
        assert.ok(rows[i].frame.y >= bottomOf(rows[i - 1].frame) - 0.5, `${what} rows do not overlap`);
    }
}

for (const device of DEVICES) {
    for (const language of ['zh-CN', 'en-US']) {
        for (const fontScale of [1, 1.3, 1.5, 2]) {
            const where = `${device.name}, ${language}, font scale ${fontScale}`;

            test(`song options panel on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, fontSizes} = renderPanel(env, 'MusicItemOptions', {musicItem: MUSIC});
                try {
                    // 头部：歌名、歌手各最多两行，不被裁、不出面板
                    const title = findOne(root, byText(MUSIC.title), 'song title');
                    assert.equal(title.metrics.fontSize, fontSizes.content * fontScale, 'the panel follows the system font');
                    const artist = findOne(root, record => isText(record) && record.text.startsWith(MUSIC.artist), 'artist line');
                    const panelBody = findOne(root, record => record.type === 'ScrollView', 'options list');
                    for (const text of [title, artist]) {
                        assertReadable(text, `"${text.text}"`);
                        assert.ok(text.textInfo.shownLines <= 2);
                        assert.ok(rightOf(text.frame) <= rightOf(panelBody.frame) + 1, `"${text.text}" stays inside the panel`);
                        assert.ok(bottomOf(text.frame) <= panelBody.frame.y + 0.5, `"${text.text}" is above the options`);
                    }
                    // 文字框按像素向上取整，上下两行相差不到 1 dp 不算压住
                    assert.ok(bottomOf(title.frame) <= artist.frame.y + 1, 'artist is below the title');

                    // 选项行
                    const rows = findAll(panelBody, record => record.props.accessibilityRole === 'button');
                    assertRows(rows, 'option');
                    for (const key of ['musicListEditor.addToNextPlay', 'common.download']) {
                        findOne(panelBody, byText(t(key)), key);
                    }
                } finally {
                    unmount();
                }
            });

            test(`add-to-playlist panel on ${where}`, () => {
                const env = createEnv({...device, language, fontScale});
                const {root, unmount, t, fontSizes} = renderPanel(env, 'AddToMusicSheet', {musicItem: MUSIC});
                try {
                    const title = findOne(root, byText(t('panel.addToMusicSheet.title', {count: 1})), 'panel title');
                    assert.equal(title.metrics.fontSize, fontSizes.title * fontScale, 'the panel follows the system font');
                    assertReadable(title, 'panel title');
                    assert.equal(title.textInfo.shownLines, 1);

                    const list = findOne(root, record => record.type === 'ScrollView', 'sheet list');
                    const rows = findAll(list, record => record.props.accessibilityRole === 'button');
                    // 新建歌单 + 每个歌单一行
                    assert.equal(rows.length, 1 + SHEETS.length);
                    assertRows(rows, 'playlist');
                    for (const sheet of SHEETS) {
                        const count = findOne(list, byText(t('panel.addToMusicSheet.count', {count: sheet.worksNum})), `count of ${sheet.title}`);
                        const name = findOne(list, byText(sheet.title), sheet.title);
                        assert.ok(bottomOf(name.frame) <= count.frame.y + 1, `count is below ${sheet.title}`);
                    }
                } finally {
                    unmount();
                }
            });
        }
    }
}

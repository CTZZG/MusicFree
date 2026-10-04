// 播放页：渲染真实的 MusicDetail（导航栏、封面、歌名、迷你歌词、进度条、播放控制、
// 操作栏），在几种窗口、封面样式和系统字体缩放下排版，检查：
// - 封面、歌名、迷你歌词都在导航栏以下、进度条以上，彼此不重叠；
// - 歌名和导航栏文字没有被裁掉，导航栏的文字不伸出导航栏；
// - 进度条、播放控制和操作栏没有被裁掉，时间和角标是一行。
// 背景、全屏歌词页和原生模块用桩代替，它们不参与左边这一栏的排版。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
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
    platform: '测试音源',
    title: '晴天（Live at 地表最强世界巡回演唱会 台北站）',
    artist: '周杰伦',
    album: '地表最强世界巡回演唱会 Live',
    artwork: 'https://example.invalid/cover.jpg',
    duration: 269,
};

const LYRICS = [
    '故事的小黄花',
    '从出生那年就飘着',
    '童年的荡秋千',
    '随记忆一直晃到现在',
    'Re So So Si Do Si La',
    'So La Si Si Si Si La Si La So',
].map((lrc, index) => ({time: index * 4, lrc, index}));

function noop() {}

function SimpleView(props) {
    return h('View', props);
}

function createPlayerStubs(env) {
    return {
        ...createCommonStubs(env),
        '@react-native-community/slider': strictStub('slider', {
            // 原生滑块：没有写高度就量不出来
            default: function Slider(props) {
                const height = [props.style].flat().find(style => style?.height)?.height;
                if (typeof height !== 'number') {
                    throw new Error('Slider without an explicit height');
                }
                return h('View', props);
            },
        }),
        '@react-native-masked-view/masked-view': strictStub('masked-view', {
            default: SimpleView,
        }),
        'react-native-linear-gradient': strictStub('linear-gradient', {
            default: SimpleView,
        }),
        '@react-navigation/native': strictStub('@react-navigation/native', {
            useNavigation: () => ({goBack: noop, navigate: noop}),
        }),
        'react-native-share': strictStub('react-native-share', {
            default: {open: async () => {}},
        }),
        'expo-keep-awake': strictStub('expo-keep-awake', {
            activateKeepAwakeAsync: async () => {},
            deactivateKeepAwake: noop,
        }),
        '@/components/base/statusBar': strictStub('statusBar', {default: () => null}),
        // 绝对定位铺在最底下，不参与排版
        '@/pages/musicDetail/components/background': strictStub('background', {
            default: () => null,
        }),
        // 横屏右半边的全屏歌词，外面那层 flex: 1 的容器还在
        '@/pages/musicDetail/components/content/lyric': strictStub('lyric', {
            default: () => null,
        }),
        '@/pages/musicDetail/artworkContext': strictStub('artworkContext', {
            MusicDetailArtworkProvider: ({children}) => children,
            useMusicDetailVisuals: () => ({
                musicKey: 'k',
                coverArtwork: MUSIC.artwork,
                ambientArtwork: MUSIC.artwork,
                displayArtwork: MUSIC.artwork,
            }),
        }),
        '@/core/trackPlayer': strictStub('@/core/trackPlayer', {
            default: {
                play: noop,
                pause: noop,
                seekTo: noop,
                skipToNext: async () => {},
                skipToPrevious: async () => {},
                toggleRepeatMode: noop,
                setRate: async () => {},
                changeQualityWithResult: async () => ({success: true}),
            },
            useCurrentMusic: () => MUSIC,
            useMusicState: () => 'playing',
            useProgress: () => ({position: 83, duration: MUSIC.duration}),
            useMusicQuality: () => 'standard',
            useRepeatMode: () => 'QUEUE',
        }),
        '@/core/lyricManager': strictStub('@/core/lyricManager', {
            useLyricState: () => ({
                loading: false,
                lyrics: LYRICS,
                hasTranslation: false,
                hasRomanization: false,
            }),
            useNormalizedCurrentLyricState: () => ({line: LYRICS[2]}),
            getCurrentPositionMsShared: () => ({value: 9000}),
        }),
        '@/core/musicSheet': strictStub('@/core/musicSheet', {
            default: {defaultSheet: {id: 'favorite'}, addMusic: noop, removeMusic: noop},
            useFavorite: () => false,
        }),
        '@/core/pluginManager': strictStub('@/core/pluginManager', {
            default: {
                getByMedia: () => ({
                    hash: 'p',
                    name: '测试音源',
                    supportedMethods: new Set(['getMusicComments', 'search']),
                }),
            },
        }),
        '@/core/localMusicSheet': strictStub('@/core/localMusicSheet', {
            default: {useIsLocal: () => false},
        }),
        '@/core/downloader': strictStub('@/core/downloader', {
            default: {download: noop},
        }),
        '@/utils/delay': strictStub('@/utils/delay', {default: async () => {}}),
    };
}

function renderPlayer(env) {
    const loader = createModuleLoader(createPlayerStubs(env));
    const MusicDetail = loader.load('@/pages/musicDetail').default;
    const i18n = loader.load('@/core/i18n').default;
    const {width, height} = env.window;
    const page = inAppFontScaleScope(loader, {route: 'music-detail'}, h(MusicDetail));
    return {...renderLayout(page, {env, width, height}), t: i18n.t};
}

const byLabel = label => record => record.props.accessibilityLabel === label;

function isInside(record, ancestor) {
    for (let node = record.parent; node; node = node.parent) {
        if (node === ancestor) {
            return true;
        }
    }
    return false;
}

const bottomOf = frame => frame.y + frame.height;

/** 播放页上各块的位置，按无障碍标签和文字找，不依赖样式细节 */
function landmarks(root, t) {
    const collapse = findOne(root, byLabel(t('musicDetail.collapse.a11y')), 'collapse button');
    const nav = collapse.parent;
    const slider = findOne(root, byLabel(t('musicDetail.seekBar.a11y')), 'seek bar');
    const seekBar = slider.parent;
    const outsideNav = record => !isInside(record, nav);
    const songText = text =>
        findAll(root, record => isText(record) && record.text === text && outsideNav(record));
    const [title] = songText(MUSIC.title);
    const [artist] = songText(MUSIC.artist);
    const [album] = songText(MUSIC.album);
    // 封面：导航栏以外最大的一张图。大图样式画在背景里，横屏放不下时不显示
    const cover =
        findAll(root, record => record.type === 'Image' && outsideNav(record)).sort(
            (a, b) => b.frame.width * b.frame.height - a.frame.width * a.frame.height,
        )[0] ?? null;
    // 迷你歌词的每一行（逐字高亮的那行拆成了单个字），和它们所在的裁剪窗口
    const lyricLines = findAll(
        root,
        record =>
            isText(record) &&
            LYRICS.some(line => line.lrc === record.text || line.lrc.includes(record.text)),
    );
    let miniLyric = null;
    for (let node = lyricLines[0]?.parent; node; node = node.parent) {
        if ([node.props.style].flat(Infinity).some(style => style?.overflow === 'hidden')) {
            miniLyric = node;
            break;
        }
    }
    const controls = [
        'musicDetail.playControl.previous.a11y',
        'musicDetail.playControl.pause.a11y',
        'musicDetail.playControl.next.a11y',
        'repeatMode.QUEUE',
        'common.download',
        'common.comment',
        'musicBar.playlist.a11y',
    ].map(key => findOne(root, byLabel(t(key)), key));
    // 进度时间和音质、倍速角标
    const seekBarTexts = findAll(seekBar, isText);
    // 导航栏本身是一条透明的带子；不能被盖住的是里面的按钮、文字和小封面
    const navContentBottom = Math.max(
        ...findAll(
            nav,
            record =>
                record !== nav &&
                (isText(record) ||
                    record.type === 'Image' ||
                    record.props.accessibilityRole === 'button'),
        ).map(record => bottomOf(record.frame)),
    );
    return {
        nav,
        navContentBottom,
        seekBar,
        controlTop: seekBar.frame.y,
        title,
        artist,
        album,
        cover,
        miniLyric,
        controls,
        seekBarTexts,
        lyricLines,
    };
}

function assertNotClipped(record, what) {
    const clipper = clippingAncestor(record);
    assert.equal(
        clipper,
        null,
        `${what} ${describeFrame(record.frame)} is clipped by ${clipper?.path} ${clipper ? describeFrame(clipper.frame) : ''}`,
    );
    if (record.textInfo) {
        assert.ok(
            !record.textInfo.clippedVertically,
            `${what} ${describeFrame(record.frame)} is too short for its text`,
        );
        assert.ok(!record.textInfo.squeezed, `${what} ${describeFrame(record.frame)} has no room`);
        // 文字不伸出自己的底色或按钮（文字框宽度按像素向上取整，放宽到 1 dp）
        assert.ok(
            contains(record.parent.frame, record.frame, 1),
            `${what} ${describeFrame(record.frame)} spills out of ${describeFrame(record.parent.frame)}`,
        );
    }
}

/** 单行歌名至少有所在这一栏宽度的三分之一，不然只能显示两三个字 */
function assertReadableWidth(text, columnWidth, what) {
    assert.ok(
        text.frame.width >= columnWidth / 3,
        `${what} is only ${text.frame.width.toFixed(1)} dp wide in a ${columnWidth.toFixed(1)} dp column`,
    );
}

function assertLyricLines(marks) {
    for (const line of marks.lyricLines) {
        assert.ok(
            !line.textInfo.clippedVertically,
            `lyric line "${line.text}" ${describeFrame(line.frame)} is cut off`,
        );
    }
}

function assertBetween(record, top, bottom, what) {
    assert.ok(
        record.frame.y >= top - 0.5 && bottomOf(record.frame) <= bottom + 0.5,
        `${what} ${describeFrame(record.frame)} should stay between y=${top.toFixed(1)} and y=${bottom.toFixed(1)}`,
    );
}

function assertControls(marks) {
    for (const control of marks.controls) {
        assertNotClipped(control, control.props.accessibilityLabel);
    }
    assertNotClipped(marks.seekBar, 'seek bar');
    for (const text of marks.seekBarTexts) {
        assert.equal(text.textInfo.neededLines, 1, `"${text.text}" fits on one line`);
        assertNotClipped(text, `"${text.text}"`);
    }
}

const FONT_SCALES = [1, 1.3, 1.5, 2];

const PORTRAIT = [
    {name: '320×640', width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {name: "the user's phone 363×806", width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
    {name: '412×915', width: 412, height: 915, scale: 2.625, insets: {top: 28, right: 0, bottom: 24, left: 0}},
];

for (const device of PORTRAIT) {
    for (const coverStyle of ['square', 'circle']) {
        for (const fontScale of FONT_SCALES) {
            test(`portrait ${device.name}, ${coverStyle} cover, font scale ${fontScale}`, () => {
                const env = createEnv({...device, fontScale, config: {'theme.coverStyle': coverStyle}});
                const {root, t, unmount} = renderPlayer(env);
                try {
                    const marks = landmarks(root, t);
                    const navBottom = marks.navContentBottom;
                    const controlTop = marks.controlTop;

                    assertBetween(marks.cover, navBottom, controlTop, 'cover');
                    assert.ok(
                        bottomOf(marks.cover.frame) <= marks.title.frame.y + 0.5,
                        'song title sits below the cover',
                    );
                    for (const [what, text] of [
                        ['title', marks.title],
                        ['artist', marks.artist],
                        ['album', marks.album],
                    ]) {
                        assertBetween(text, navBottom, controlTop, what);
                        assertNotClipped(text, what);
                    }
                    assertReadableWidth(marks.title, device.width, 'song title');
                    if (marks.miniLyric) {
                        assertBetween(
                            marks.miniLyric,
                            bottomOf(marks.album.frame),
                            controlTop,
                            'mini lyric',
                        );
                    }
                    assertLyricLines(marks);
                    assertControls(marks);
                } finally {
                    unmount();
                }
            });
        }
    }

    for (const fontScale of FONT_SCALES) {
        test(`portrait ${device.name}, hero cover, font scale ${fontScale}`, () => {
            const env = createEnv({...device, fontScale, config: {'theme.coverStyle': 'hero'}});
            const {root, t, unmount} = renderPlayer(env);
            try {
                const marks = landmarks(root, t);
                const navBottom = marks.navContentBottom;
                const controlTop = marks.controlTop;
                // 大图画在背景里；这里管的是叠在图上的歌名和迷你歌词
                for (const [what, text] of [
                    ['title', marks.title],
                    ['artist', marks.artist],
                ]) {
                    assertBetween(text, navBottom, controlTop, what);
                    assertNotClipped(text, what);
                }
                assertReadableWidth(marks.title, device.width, 'song title');
                if (marks.miniLyric) {
                    assertBetween(marks.miniLyric, navBottom, marks.title.frame.y, 'mini lyric');
                }
                assertLyricLines(marks);
                assertControls(marks);
            } finally {
                unmount();
            }
        });
    }
}

const LANDSCAPE = [
    {name: "the user's phone 806×363", width: 806, height: 363, scale: 3.5, insets: {top: 24, right: 0, bottom: 0, left: 0}},
    {name: '800×320', width: 800, height: 320, scale: 2, insets: {top: 24, right: 0, bottom: 0, left: 0}},
    {name: '568×320', width: 568, height: 320, scale: 2, insets: {top: 0, right: 0, bottom: 0, left: 0}},
];

for (const device of LANDSCAPE) {
    for (const coverStyle of ['square', 'circle']) {
        for (const fontScale of FONT_SCALES) {
            test(`landscape ${device.name}, ${coverStyle} cover, font scale ${fontScale}`, () => {
                const env = createEnv({...device, fontScale, config: {'theme.coverStyle': coverStyle}});
                const {root, t, unmount} = renderPlayer(env);
                try {
                    const marks = landmarks(root, t);
                    const navBottom = bottomOf(marks.nav.frame);
                    const controlTop = marks.controlTop;

                    // 导航栏里的小封面和歌名不伸出导航栏
                    for (const text of findAll(marks.nav, isText)) {
                        assert.ok(
                            contains(marks.nav.frame, text.frame),
                            `nav text "${text.text}" ${describeFrame(text.frame)} stays inside the nav bar ${describeFrame(marks.nav.frame)}`,
                        );
                        assertNotClipped(text, `nav text "${text.text}"`);
                    }

                    // 内容区太矮时不放封面（导航栏上有小封面）
                    if (marks.cover) {
                        assertBetween(marks.cover, navBottom, controlTop, 'cover');
                        assertNotClipped(marks.cover, 'cover');
                    }
                    // 歌名区按高度决定显示几行：标题一定有，歌手、专辑放得下才显示
                    assert.ok(marks.title, 'song title is shown');
                    for (const [what, text] of [
                        ['title', marks.title],
                        ['artist', marks.artist],
                        ['album', marks.album],
                    ]) {
                        if (!text) {
                            continue;
                        }
                        assertBetween(text, navBottom, controlTop, what);
                        assertNotClipped(text, what);
                        if (marks.cover) {
                            assert.ok(
                                text.frame.x >= marks.cover.frame.x + marks.cover.frame.width,
                                `${what} is beside the cover, not on it`,
                            );
                        }
                    }
                    // 左半边一栏（导航栏和它一样宽）
                    assertReadableWidth(marks.title, marks.nav.frame.width, 'song title');
                    assertControls(marks);
                } finally {
                    unmount();
                }
            });
        }
    }
}

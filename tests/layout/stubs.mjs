/**
 * 布局测试共用的桩：原生模块、运行时服务换成只够渲染的最小实现。
 * 每个桩只提供被用到的导出（strictStub），组件多用了一个没准备的导出会直接报错，
 * 不会悄悄拿到 undefined。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {React, createReactNativeStub, flattenStyle, strictStub} from './harness.mjs';

const h = React.createElement;
const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
);

/**
 * 一台设备：窗口尺寸、像素密度、系统字体缩放、安全区、应用设置、界面语言。
 * 用户手机 1272×2822 像素、3.5 倍，约 363×806 dp。
 */
export function createEnv({
    width,
    height,
    scale = 3.5,
    fontScale = 1,
    insets = {top: 0, right: 0, bottom: 0, left: 0},
    config = {},
    language = 'zh-CN',
}) {
    return {
        window: {width, height, scale, fontScale},
        insets,
        config,
        language,
    };
}

const LANGUAGE_FILES = {
    'zh-CN': 'zh-cn.json',
    'zh-TW': 'zh-tw.json',
    'en-US': 'en-us.json',
};

function loadLanguage(locale) {
    return JSON.parse(
        fs.readFileSync(
            path.join(rootDir, 'src/core/i18n/languages', LANGUAGE_FILES[locale]),
            'utf8',
        ),
    );
}

/** 真实的语言包：文字长度直接影响排版，不能用键名代替 */
function createI18nStub(env) {
    const primary = loadLanguage(env.language);
    const fallback = loadLanguage('zh-CN');
    const i18n = {
        t(key, args) {
            const value = primary[key] ?? fallback[key];
            if (value === undefined) {
                throw new Error(`Missing i18n key "${key}"`);
            }
            return args
                ? value.replace(/{(\w+)}/g, (_, name) => args[name] ?? '')
                : value;
        },
    };
    return strictStub('@/core/i18n', {default: i18n, useI18N: () => i18n});
}

// 颜色只影响绘制，统一给一个
const colors = new Proxy(
    {},
    {get: (_, key) => (typeof key === 'string' ? '#808080' : undefined)},
);

function createReanimatedStub() {
    // 第一帧：动画样式按共享值的初始值算一次；动画本身不跑
    const identity = value => value;
    const easing = new Proxy(
        {},
        {
            get: (_, key) =>
                ['in', 'out', 'inOut', 'bezier', 'poly', 'elastic', 'back'].includes(key)
                    ? () => identity
                    : identity,
        },
    );
    const animated = type =>
        function AnimatedHost(props) {
            return h(type, props);
        };
    const Animated = {
        View: animated('View'),
        Text: animated('Text'),
        ScrollView: animated('ScrollView'),
        Image: animated('Image'),
        createAnimatedComponent: component => component,
    };
    const interpolate = (value, input, output) => {
        if (value <= input[0]) {
            return output[0];
        }
        for (let i = 1; i < input.length; i += 1) {
            if (value <= input[i]) {
                const t = (value - input[i - 1]) / (input[i] - input[i - 1]);
                return output[i - 1] + t * (output[i] - output[i - 1]);
            }
        }
        return output[output.length - 1];
    };
    return strictStub('react-native-reanimated', {
        default: Animated,
        ...Animated,
        Easing: easing,
        useSharedValue: initial => React.useState(() => ({value: initial}))[0],
        makeMutable: initial => ({value: initial}),
        useDerivedValue: compute => ({value: compute()}),
        useAnimatedStyle: compute => compute(),
        useAnimatedReaction: () => {},
        useAnimatedRef: () => React.useRef(null),
        useAnimatedScrollHandler: () => () => {},
        withTiming: identity,
        withSpring: identity,
        withRepeat: identity,
        withDelay: (_, value) => value,
        withSequence: (...values) => values[values.length - 1],
        cancelAnimation: () => {},
        runOnJS: identity,
        runOnUI: identity,
        interpolate,
        interpolateColor: (_, __, output) => output[0],
        Extrapolation: {CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity'},
    });
}

function createGestureHandlerStub(RN) {
    const builder = new Proxy({}, {get: () => () => builder});
    return strictStub('react-native-gesture-handler', {
        Gesture: new Proxy({}, {get: () => () => builder}),
        GestureDetector: ({children}) => children,
        Pressable: RN.Pressable,
        TouchableOpacity: RN.Pressable,
        ScrollView: RN.ScrollView,
    });
}

function createSafeAreaStub(env) {
    const EDGE_PADDING = {
        top: ['paddingTop', 'paddingVertical'],
        right: ['paddingRight', 'paddingHorizontal'],
        bottom: ['paddingBottom', 'paddingVertical'],
        left: ['paddingLeft', 'paddingHorizontal'],
    };
    function SafeAreaView({edges, style, ...rest}) {
        // 安全区内边距叠加在样式自己的内边距上
        const own = flattenStyle(style);
        const padding = {};
        for (const edge of edges ?? ['top', 'right', 'bottom', 'left']) {
            const [key, axisKey] = EDGE_PADDING[edge];
            padding[key] =
                env.insets[edge] + (own[key] ?? own[axisKey] ?? own.padding ?? 0);
        }
        return h('View', {...rest, style: [own, padding]});
    }
    return strictStub('react-native-safe-area-context', {
        SafeAreaView,
        useSafeAreaInsets: () => env.insets,
    });
}

/** 图标是 SVG：react-native-svg 把 width/height 写进根视图的样式（flex: 0） */
function Icon(props) {
    const side = props.width ?? props.size;
    if (typeof side !== 'number') {
        throw new Error(`Icon "${props.name}" has no size`);
    }
    return h('View', {
        ...props,
        style: [props.style, {width: side, height: side, flex: 0}],
    });
}

/** expo-image：尺寸只来自样式，没有尺寸会在排版时报错 */
function FastImage(props) {
    return h('Image', props);
}

const assetHandles = new Proxy({}, {get: (_, key) => (typeof key === 'string' ? 1 : undefined)});

/**
 * @shopify/flash-list 2 的网格（GridLayoutManager）：可用宽度是列表内容区去掉左右
 * 内边距，每格宽 = 可用宽度 / 列数，按行排，同一行的格子一样高（取最高的一格）。
 * 没有数据时排 ListEmptyComponent；ListFooterComponent 在最后。都在滚动内容里。
 */
export function FlashListGrid({
    data,
    renderItem,
    numColumns = 1,
    contentContainerStyle,
    ListEmptyComponent,
    ListFooterComponent,
}) {
    const rows = [];
    for (let start = 0; start < data.length; start += numColumns) {
        rows.push(data.slice(start, start + numColumns));
    }
    return h(
        'ScrollView',
        {contentContainerStyle},
        data.length
            ? rows.map((row, rowIndex) =>
                h(
                    'View',
                    {key: rowIndex, style: {flexDirection: 'row'}},
                    row.map((item, column) =>
                        h(
                            'View',
                            {key: column, style: {width: `${100 / numColumns}%`}},
                            renderItem({item, index: rowIndex * numColumns + column}),
                        ),
                    ),
                ),
            )
            : ListEmptyComponent ?? null,
        ListFooterComponent ?? null,
    );
}

const ABSOLUTE_FILL = {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0};

/**
 * react-native-tab-view 4 的 TabView：外层 flex: 1、overflow: hidden，标签栏在上，
 * 下面的 PagerView 占满剩下的高度。PagerView 的每一页和当前页一样大，这里只排当前
 * 这一页（SceneView：flex: 1、overflow: hidden）。
 */
function TabView({navigationState, renderTabBar, renderScene, style}) {
    const route = navigationState.routes[navigationState.index];
    const sceneProps = {layout: {width: 0, height: 0}, jumpTo() {}, position: null};
    return h(
        'View',
        {style: [{flex: 1, overflow: 'hidden'}, style]},
        renderTabBar({...sceneProps, navigationState}),
        h(
            'View',
            {style: {flex: 1}},
            h(
                'View',
                {key: route.key, style: {flex: 1, overflow: 'hidden'}},
                renderScene({...sceneProps, route}),
            ),
        ),
    );
}

/**
 * react-native-tab-view 4 的 TabBar（可横向滚动）：一行标签放在横向的 FlatList 里。
 * 每个标签（TabBarItem）是一层可点的视图，里面是 flex: 1、居中、padding 10、
 * minHeight 48 的容器，叠着未选中、选中两份文字（选中的那份绝对定位盖在上面）。
 * 只支持 scrollEnabled，且标签宽度由 tabStyle.width 给出（auto 或数值）。
 */
function TabBar({navigationState, options, style, tabStyle, contentContainerStyle, scrollEnabled}) {
    if (!scrollEnabled || flattenStyle(tabStyle).width === undefined) {
        throw new Error('The TabBar stub models scrollable tab bars with tabStyle.width only');
    }
    const tabs = navigationState.routes.map((route, index) => {
        const focused = index === navigationState.index;
        const label = options?.[route.key]?.label;
        const renderLabel = labelFocused =>
            label
                ? label({focused: labelFocused, route, labelText: route.title})
                : h('Text', null, route.title);
        return h(
            'View',
            {
                key: route.key,
                accessibilityRole: 'tab',
                accessibilityLabel: route.title,
                accessibilityState: {selected: focused},
            },
            h(
                'View',
                {
                    pointerEvents: 'none',
                    style: [
                        {
                            flex: 1,
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 10,
                            minHeight: 48,
                        },
                        tabStyle,
                    ],
                },
                h(
                    'View',
                    null,
                    h('View', null, renderLabel(false)),
                    h('View', {style: ABSOLUTE_FILL}, renderLabel(true)),
                ),
            ),
        );
    });
    return h(
        'View',
        {style: [{zIndex: 1}, style]},
        h(
            'View',
            {style: {overflow: 'scroll'}},
            h(
                'ScrollView',
                {
                    horizontal: true,
                    contentContainerStyle: [
                        {flexGrow: 1, flexDirection: 'row', flexWrap: 'nowrap'},
                        contentContainerStyle,
                    ],
                },
                tabs,
            ),
        ),
    );
}

export function createTabViewStub() {
    return strictStub('react-native-tab-view', {TabView, TabBar});
}

/**
 * 和 App 一样包上字体缩放的范围：登记过（src/constants/fontScaleMigration.ts）的
 * 页面、面板里 ThemeText 跟随系统字体。App 在 src/entry 和面板入口各包一层。
 * loader 要和渲染页面用的是同一个，ThemeText 才读得到这一层。
 * @param {{route?: string, panel?: string}} where 路由名或面板名
 */
export function inAppFontScaleScope(loader, where, element) {
    const {FontScaleScope} = loader.load('@/components/base/fontScaleScope');
    const migration = loader.load('@/constants/fontScaleMigration');
    const followSystem = where.route
        ? migration.fontScaleMigratedRoutes.has(where.route)
        : migration.fontScaleMigratedPanels.has(where.panel);
    return h(FontScaleScope, {followSystem}, element);
}

/**
 * 大多数页面都要的桩。测试再按需补上页面自己的依赖。
 * @returns {Record<string, unknown>}
 */
export function createCommonStubs(env) {
    const RN = createReactNativeStub(env);
    const appConfig = {
        getConfig: key => env.config[key],
        setConfig() {},
    };
    return {
        'react-native': RN,
        'react-native-reanimated': createReanimatedStub(),
        'react-native-gesture-handler': createGestureHandlerStub(RN),
        'react-native-safe-area-context': createSafeAreaStub(env),
        // 只用来给占位文字调透明度
        color: () => {
            const chain = {alpha: () => chain, toString: () => '#808080'};
            return chain;
        },
        '@/core/i18n': createI18nStub(env),
        '@/core/appConfig': strictStub('@/core/appConfig', {
            default: appConfig,
            useAppConfig: key => env.config[key],
        }),
        '@/hooks/useColors': strictStub('@/hooks/useColors', {default: () => colors}),
        '@/hooks/useOrientation': strictStub('@/hooks/useOrientation', {
            default: () =>
                env.window.width < env.window.height ? 'vertical' : 'horizontal',
        }),
        '@/utils/persistStatus': strictStub('@/utils/persistStatus', {
            default: {
                get: () => undefined,
                set() {},
                useValue: (_, defaultValue) => defaultValue,
            },
        }),
        '@/utils/toast': strictStub('@/utils/toast', {
            default: {success() {}, warn() {}, error() {}},
        }),
        '@/utils/log': strictStub('@/utils/log', {
            devLog() {},
            errorLog() {},
            trace() {},
        }),
        '@/components/base/icon': strictStub('@/components/base/icon', {default: Icon}),
        '@/components/base/fastImage': strictStub('@/components/base/fastImage', {
            default: FastImage,
        }),
        '@/constants/assetsConst': strictStub('@/constants/assetsConst', {
            ImgAsset: assetHandles,
            B64Asset: new Proxy({}, {get: () => 'data:image/png;base64,'}),
        }),
        '@/components/panels/usePanel': strictStub('@/components/panels/usePanel', {
            showPanel() {},
            hidePanel() {},
            panelInfoStore: {setValue() {}, getValue: () => ({})},
        }),
        '@/core/router': strictStub('@/core/router', {
            ROUTE_PATH: new Proxy({}, {get: (_, key) => String(key)}),
            useNavigate: () => () => {},
        }),
    };
}

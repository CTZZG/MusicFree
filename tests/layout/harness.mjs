/**
 * 布局测试工具：渲染真实组件，用 Yoga 按 React Native 的规则排版，再对排版结果
 * 做语义断言（歌名不进入控制区、标题不被裁掉……）。
 *
 * 只认识明确支持的东西：不认识的样式键、宿主组件、依赖一律报错，不默默当成 0。
 * 测试要显式提供运行时服务（播放器、插件、导航……）和原生组件的桩。
 *
 * 模型的边界，写断言时按这个理解：
 * - Yoga 与 RN 0.85 内置的同一代（3.x），配置照 RN：非 Web 默认值、
 *   errata = All（RN 的默认兼容模式）、按设备像素取整；
 * - 文字不是原生测量：宽度按 Android 默认字体 Roboto 的字宽估算（中日韩、全角、
 *   emoji 1 个字号宽，大写 0.64，数字 0.56，小写 0.52，窄标点 0.26，空格 0.25，
 *   粗体再 ×1.05），按宽度折行；行高取样式的 lineHeight，没写时按 Android 的
 *   字体度量（字号 ×1.32，includeFontPadding: false 时 ×1.17）。系统字体缩放按
 *   allowFontScaling 和 maxFontSizeMultiplier 生效，行高跟着放大。估算比真机
 *   略宽，用来发现量级上的越界，几个 dp 以内的差别不要拿来断言；
 * - 原生组件（图片、图标、滑块）的尺寸由样式或桩给出，没有尺寸就报错；
 * - onLayout 按排版结果回调，组件据此重新渲染后再排，直到结果稳定，
 *   与 RN「先估一帧、量到后再排」的流程一致；
 * - 排版本身不裁剪，断言看到的是内容本来的大小，overflow: hidden 掩盖不了越界。
 */
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import Yoga, {
    Align,
    Direction,
    Display,
    Edge,
    Errata,
    FlexDirection,
    Gutter,
    Justify,
    MeasureMode,
    Overflow,
    PositionType,
    Wrap,
} from 'yoga-layout';

const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
);
const srcDir = path.join(rootDir, 'src');
const requireFromRoot = createRequire(path.join(rootDir, 'package.json'));
const ts = requireFromRoot('typescript');
export const React = requireFromRoot('react');
const jsxRuntime = requireFromRoot('react/jsx-runtime');
const TestRenderer = requireFromRoot('react-test-renderer');

// 与 RN 的 Jest 预设一致：同步渲染，不提示 react-test-renderer 已弃用
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// 加载仓库里的源码
// ---------------------------------------------------------------------------

const CODE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

function resolveSourceFile(base) {
    if (CODE_EXTENSIONS.some(ext => base.endsWith(ext)) && fs.existsSync(base)) {
        return base;
    }
    for (const ext of CODE_EXTENSIONS) {
        if (fs.existsSync(base + ext)) {
            return base + ext;
        }
    }
    for (const ext of CODE_EXTENSIONS) {
        const index = path.join(base, `index${ext}`);
        if (fs.existsSync(index)) {
            return index;
        }
    }
    return null;
}

// 转译结果按文件缓存，各个加载器共用；模块实例仍然每个加载器各一份
const transpiled = new Map();

function transpile(file) {
    let code = transpiled.get(file);
    if (code === undefined) {
        code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            fileName: file,
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                jsx: ts.JsxEmit.ReactJSX,
                esModuleInterop: true,
            },
        }).outputText;
        transpiled.set(file, code);
    }
    return code;
}

/** 本地模块统一记成 @/ 开头、src 下的路径，不带扩展名和 /index，桩按这个名字找 */
function moduleIdOf(file) {
    return (
        '@/' +
        path
            .relative(srcDir, file)
            .split(path.sep)
            .join('/')
            .replace(/\.(tsx|ts|jsx|js)$/, '')
            .replace(/\/index$/, '')
    );
}

/**
 * 每组测试一个加载器：模块缓存跟着它走。rpx 这类模块在加载时读一次屏幕尺寸，
 * 换窗口尺寸要换一个加载器，和 App 冷启动一样。
 *
 * @param {Record<string, unknown>} stubs 键是包名，或本地模块的 @/ 路径
 */
export function createModuleLoader(stubs) {
    const cache = new Map();

    function requireFrom(importer, specifier) {
        if (specifier === 'react') {
            return React;
        }
        if (specifier === 'react/jsx-runtime') {
            return jsxRuntime;
        }
        let id = specifier;
        let file = null;
        if (specifier.startsWith('@/') || specifier.startsWith('.')) {
            const base = specifier.startsWith('@/')
                ? path.join(srcDir, specifier.slice(2))
                : path.resolve(path.dirname(importer), specifier);
            file = resolveSourceFile(base);
            if (!file) {
                throw new Error(
                    `Cannot resolve "${specifier}" imported by ${path.relative(rootDir, importer)}`,
                );
            }
            id = moduleIdOf(file);
        }
        if (Object.prototype.hasOwnProperty.call(stubs, id)) {
            return stubs[id];
        }
        if (!file) {
            throw new Error(
                `"${specifier}" (imported by ${path.relative(rootDir, importer)}) needs a stub; ` +
                    'the layout harness only loads repository sources and React',
            );
        }
        return load(file);
    }

    function load(file) {
        const cached = cache.get(file);
        if (cached) {
            return cached.exports;
        }
        const outputText = transpile(file);
        const module = {exports: {}};
        cache.set(file, module);
        const wrapper = vm.runInThisContext(
            `(function (exports, require, module, __filename, __dirname) {${outputText}\n})`,
            {filename: file},
        );
        wrapper(
            module.exports,
            specifier => requireFrom(file, specifier),
            module,
            file,
            path.dirname(file),
        );
        return module.exports;
    }

    return {
        /** @param {string} specifier 例如 `@/components/mediaItem/sheetItem` */
        load(specifier) {
            return requireFrom(path.join(srcDir, 'index.ts'), specifier);
        },
    };
}

/**
 * 桩对象：访问没有提供的导出时报错，而不是悄悄得到 undefined。
 * @template T
 * @param {string} name
 * @param {T} exports
 * @returns {T}
 */
export function strictStub(name, exports) {
    return new Proxy(
        {__esModule: true, ...exports},
        {
            get(target, key) {
                if (key in target) {
                    return target[key];
                }
                if (
                    typeof key === 'symbol' ||
                    key === 'then' ||
                    key === 'toJSON' ||
                    key === '$$typeof'
                ) {
                    return undefined;
                }
                throw new Error(`Stub "${name}" has no export "${String(key)}"`);
            },
        },
    );
}

// ---------------------------------------------------------------------------
// react-native 桩：宿主组件用字符串类型，交给 Yoga 排版
// ---------------------------------------------------------------------------

export function flattenStyle(style) {
    if (!style) {
        return {};
    }
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map(flattenStyle));
    }
    return style;
}

/**
 * @param {{window: {width: number, height: number, scale: number, fontScale: number}}} env
 *   测试可以在渲染之间修改 env.window（例如字体缩放）
 */
export function createReactNativeStub(env) {
    const h = React.createElement;
    const resolveState = (value, state) =>
        typeof value === 'function' ? value(state) : value;

    function Pressable({style, children, ...rest}) {
        const state = {pressed: false};
        return h(
            'View',
            {...rest, style: resolveState(style, state)},
            resolveState(children, state),
        );
    }

    function ActivityIndicator({size = 'small', style, ...rest}) {
        const side = size === 'large' ? 36 : typeof size === 'number' ? size : 20;
        return h('View', {...rest, style: [{width: side, height: side}, style]});
    }

    // 键盘收起时就是一层 View；behavior 为 position 时里面再包一层内容容器
    function KeyboardAvoidingView({behavior, contentContainerStyle, children, ...rest}) {
        return h(
            'View',
            rest,
            behavior === 'position'
                ? h('View', {style: contentContainerStyle}, children)
                : children,
        );
    }

    return strictStub('react-native', {
        View: 'View',
        Text: 'Text',
        Image: 'Image',
        TextInput: 'TextInput',
        ScrollView: 'ScrollView',
        Pressable,
        TouchableOpacity: Pressable,
        TouchableHighlight: Pressable,
        TouchableWithoutFeedback: Pressable,
        ActivityIndicator,
        KeyboardAvoidingView,
        StyleSheet: {
            create: styles => styles,
            flatten: flattenStyle,
            compose: (a, b) => (a && b ? [a, b] : a || b),
            get hairlineWidth() {
                return 1 / env.window.scale;
            },
            absoluteFill: {position: 'absolute', left: 0, right: 0, top: 0, bottom: 0},
            absoluteFillObject: {
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
            },
        },
        useWindowDimensions: () => env.window,
        Dimensions: {
            get: () => env.window,
            addEventListener: () => ({remove() {}}),
        },
        PixelRatio: {
            get: () => env.window.scale,
            getFontScale: () => env.window.fontScale,
            roundToNearestPixel: value =>
                Math.round(value * env.window.scale) / env.window.scale,
        },
        Platform: {
            OS: 'android',
            Version: 36,
            select: spec => ('android' in spec ? spec.android : spec.default),
        },
        I18nManager: {isRTL: false},
        InteractionManager: {
            runAfterInteractions: task => {
                task?.();
                return {cancel() {}};
            },
        },
        Keyboard: {
            dismiss() {},
            isVisible: () => false,
            metrics: () => undefined,
            addListener: () => ({remove() {}}),
        },
        BackHandler: {addEventListener: () => ({remove() {}})},
        DeviceEventEmitter: {addListener: () => ({remove() {}})},
    });
}

// ---------------------------------------------------------------------------
// 样式 → Yoga
// ---------------------------------------------------------------------------

const EDGE_SUFFIXES = {
    '': Edge.All,
    Horizontal: Edge.Horizontal,
    Vertical: Edge.Vertical,
    Top: Edge.Top,
    Bottom: Edge.Bottom,
    Left: Edge.Left,
    Right: Edge.Right,
    Start: Edge.Start,
    End: Edge.End,
};

const ENUMS = {
    flexDirection: {
        row: FlexDirection.Row,
        column: FlexDirection.Column,
        'row-reverse': FlexDirection.RowReverse,
        'column-reverse': FlexDirection.ColumnReverse,
    },
    flexWrap: {wrap: Wrap.Wrap, nowrap: Wrap.NoWrap, 'wrap-reverse': Wrap.WrapReverse},
    justifyContent: {
        'flex-start': Justify.FlexStart,
        center: Justify.Center,
        'flex-end': Justify.FlexEnd,
        'space-between': Justify.SpaceBetween,
        'space-around': Justify.SpaceAround,
        'space-evenly': Justify.SpaceEvenly,
    },
    align: {
        auto: Align.Auto,
        'flex-start': Align.FlexStart,
        center: Align.Center,
        'flex-end': Align.FlexEnd,
        stretch: Align.Stretch,
        baseline: Align.Baseline,
        'space-between': Align.SpaceBetween,
        'space-around': Align.SpaceAround,
    },
    position: {
        absolute: PositionType.Absolute,
        relative: PositionType.Relative,
        static: PositionType.Static,
    },
    display: {none: Display.None, flex: Display.Flex},
    overflow: {
        visible: Overflow.Visible,
        hidden: Overflow.Hidden,
        scroll: Overflow.Scroll,
    },
};

// 只影响绘制、不影响排版的样式。Text 的字号、行高等由文字测量单独读取。
const PAINT_ONLY_KEYS = new Set([
    'color',
    'backgroundColor',
    'opacity',
    'borderRadius',
    'borderTopLeftRadius',
    'borderTopRightRadius',
    'borderBottomLeftRadius',
    'borderBottomRightRadius',
    'borderTopStartRadius',
    'borderTopEndRadius',
    'borderBottomStartRadius',
    'borderBottomEndRadius',
    'borderCurve',
    'borderColor',
    'borderTopColor',
    'borderBottomColor',
    'borderLeftColor',
    'borderRightColor',
    'borderStartColor',
    'borderEndColor',
    'borderStyle',
    'shadowColor',
    'shadowOffset',
    'shadowOpacity',
    'shadowRadius',
    'elevation',
    'boxShadow',
    'transform',
    'zIndex',
    'tintColor',
    'overlayColor',
    'resizeMode',
    'objectFit',
    'fontSize',
    'lineHeight',
    'fontWeight',
    'fontFamily',
    'fontStyle',
    'fontVariant',
    'letterSpacing',
    'textAlign',
    'textAlignVertical',
    'textTransform',
    'textDecorationLine',
    'textDecorationColor',
    'textDecorationStyle',
    'textShadowColor',
    'textShadowOffset',
    'textShadowRadius',
    'includeFontPadding',
    'writingDirection',
    'verticalAlign',
    'backfaceVisibility',
    'pointerEvents',
    'cursor',
    'userSelect',
    'outlineColor',
    'outlineOffset',
    'outlineStyle',
    'outlineWidth',
    'filter',
    'mixBlendMode',
    'isolation',
]);

function checkDimension(key, value, where) {
    if (
        typeof value === 'number' ||
        value === 'auto' ||
        (typeof value === 'string' && /^-?\d+(\.\d+)?%$/.test(value))
    ) {
        return value;
    }
    throw new Error(`Unsupported ${key} value ${JSON.stringify(value)} on ${where}`);
}

function applyStyle(node, style, where) {
    for (const [key, value] of Object.entries(style)) {
        if (value === undefined || value === null || PAINT_ONLY_KEYS.has(key)) {
            continue;
        }
        const dimension = () => checkDimension(key, value, where);
        const edgeMatch = /^(margin|padding|border)(Horizontal|Vertical|Top|Bottom|Left|Right|Start|End)?(Width)?$/.exec(
            key,
        );
        if (edgeMatch && (edgeMatch[1] !== 'border' || edgeMatch[3])) {
            const edge = EDGE_SUFFIXES[edgeMatch[2] ?? ''];
            if (edgeMatch[1] === 'margin') {
                node.setMargin(edge, dimension());
            } else if (edgeMatch[1] === 'padding') {
                node.setPadding(edge, dimension());
            } else {
                node.setBorder(edge, value);
            }
            continue;
        }
        switch (key) {
            case 'width':
                node.setWidth(dimension());
                break;
            case 'height':
                node.setHeight(dimension());
                break;
            case 'minWidth':
                node.setMinWidth(dimension());
                break;
            case 'minHeight':
                node.setMinHeight(dimension());
                break;
            case 'maxWidth':
                node.setMaxWidth(dimension());
                break;
            case 'maxHeight':
                node.setMaxHeight(dimension());
                break;
            case 'flex':
                node.setFlex(value);
                break;
            case 'flexGrow':
                node.setFlexGrow(value);
                break;
            case 'flexShrink':
                node.setFlexShrink(value);
                break;
            case 'flexBasis':
                node.setFlexBasis(dimension());
                break;
            case 'aspectRatio':
                node.setAspectRatio(value);
                break;
            case 'gap':
                node.setGap(Gutter.All, value);
                break;
            case 'rowGap':
                node.setGap(Gutter.Row, value);
                break;
            case 'columnGap':
                node.setGap(Gutter.Column, value);
                break;
            case 'top':
            case 'bottom':
            case 'left':
            case 'right':
            case 'start':
            case 'end':
                node.setPosition(
                    EDGE_SUFFIXES[key[0].toUpperCase() + key.slice(1)],
                    dimension(),
                );
                break;
            case 'flexDirection':
            case 'flexWrap':
            case 'justifyContent':
            case 'position':
            case 'display':
            case 'overflow': {
                const mapped = ENUMS[key][value];
                if (mapped === undefined) {
                    throw new Error(`Unsupported ${key}: ${value} on ${where}`);
                }
                const setter = {
                    flexDirection: 'setFlexDirection',
                    flexWrap: 'setFlexWrap',
                    justifyContent: 'setJustifyContent',
                    position: 'setPositionType',
                    display: 'setDisplay',
                    overflow: 'setOverflow',
                }[key];
                node[setter](mapped);
                break;
            }
            case 'alignItems':
            case 'alignSelf':
            case 'alignContent': {
                const mapped = ENUMS.align[value];
                if (mapped === undefined) {
                    throw new Error(`Unsupported ${key}: ${value} on ${where}`);
                }
                node[`set${key[0].toUpperCase()}${key.slice(1)}`](mapped);
                break;
            }
            default:
                throw new Error(`Unsupported style key "${key}" on ${where}`);
        }
    }
}

// ---------------------------------------------------------------------------
// 文字测量（近似）
// ---------------------------------------------------------------------------

function isWide(code) {
    return (
        (code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        code >= 0x1f000
    );
}

// Roboto 的字宽（以字号为单位）取各类字符的平均值，略往宽里取
function charWidth(ch, fontSize) {
    const code = ch.codePointAt(0);
    let em;
    if (isWide(code)) {
        em = 1;
    } else if (ch === ' ') {
        em = 0.25;
    } else if (/[A-Z]/.test(ch)) {
        em = 0.64;
    } else if (/[0-9]/.test(ch)) {
        em = 0.56;
    } else if (/[a-z]/.test(ch)) {
        em = 0.52;
    } else if (/[.,:;'!|]/.test(ch)) {
        em = 0.26;
    } else if (code < 0x80) {
        em = 0.4;
    } else {
        em = 0.56;
    }
    return em * fontSize;
}

function textContent(children) {
    if (children === null || children === undefined) {
        return '';
    }
    if (typeof children === 'string' || typeof children === 'number') {
        return String(children);
    }
    if (Array.isArray(children)) {
        return children.map(textContent).join('');
    }
    // 嵌套的 Text：只取文字
    return textContent(children.children);
}

function textMetrics(props, env) {
    const style = flattenStyle(props.style);
    const cap =
        typeof props.maxFontSizeMultiplier === 'number' &&
        props.maxFontSizeMultiplier >= 1
            ? props.maxFontSizeMultiplier
            : Infinity;
    const scale =
        props.allowFontScaling === false ? 1 : Math.min(env.window.fontScale, cap);
    const baseFontSize = style.fontSize ?? 14;
    const fontSize = baseFontSize * scale;
    // 没写行高时用字体自己的度量；includeFontPadding（Android 默认开）会多留上下空白
    const naturalLineHeight =
        baseFontSize * (style.includeFontPadding === false ? 1.17 : 1.32);
    const lineHeight = (style.lineHeight ?? naturalLineHeight) * scale;
    const bold = Number(style.fontWeight) >= 600 || style.fontWeight === 'bold';
    const letterSpacing = (style.letterSpacing ?? 0) * scale;
    return {fontSize, lineHeight, widthFactor: bold ? 1.05 : 1, letterSpacing};
}

/**
 * 按 Android 的方式断行：中日韩字符之间都能断，其余按词（空格处）断，行尾的
 * 空格不占宽度；一个词比整行还宽时按字符硬断。
 * @returns {{lines: number, widest: number}} 行数和最宽一行的宽度
 */
function breakParagraph(paragraph, metrics, maxWidth) {
    const widthOf = token =>
        [...token].reduce(
            (sum, ch) =>
                sum +
                charWidth(ch, metrics.fontSize) * metrics.widthFactor +
                metrics.letterSpacing,
            0,
        );
    const tokens = [];
    let word = '';
    for (const ch of paragraph) {
        if (ch === ' ' || isWide(ch.codePointAt(0))) {
            if (word) {
                tokens.push(word);
                word = '';
            }
            tokens.push(ch);
        } else {
            word += ch;
        }
    }
    if (word) {
        tokens.push(word);
    }

    const fits = width => width <= maxWidth + 1e-6;
    let lines = 1;
    let lineWidth = 0;
    let widest = 0;
    for (const token of tokens) {
        const width = widthOf(token);
        if (token === ' ') {
            lineWidth += width;
            continue;
        }
        if (fits(lineWidth + width)) {
            lineWidth += width;
        } else if (fits(width)) {
            lines += 1;
            lineWidth = width;
        } else {
            for (const ch of token) {
                const charW = widthOf(ch);
                if (!fits(lineWidth + charW) && lineWidth > 0) {
                    lines += 1;
                    lineWidth = 0;
                }
                lineWidth += charW;
            }
        }
        widest = Math.max(widest, lineWidth);
    }
    return {lines, widest};
}

function measureText(text, metrics, maxWidth, numberOfLines) {
    const paragraphs = text.split('\n');
    let naturalWidth = 0;
    let lines = 0;
    let widest = 0;
    for (const paragraph of paragraphs) {
        naturalWidth = Math.max(
            naturalWidth,
            breakParagraph(paragraph, metrics, Infinity).widest,
        );
        const broken = breakParagraph(paragraph, metrics, Math.max(0, maxWidth));
        lines += broken.lines;
        widest = Math.max(widest, broken.widest);
    }
    const shownLines =
        numberOfLines && numberOfLines > 0 ? Math.min(lines, numberOfLines) : lines;
    return {
        /** 不限宽时一行排开的宽度 */
        naturalWidth,
        /** 按给定宽度断行后最宽一行的宽度 */
        width: Math.min(widest, maxWidth),
        neededLines: lines,
        shownLines,
        truncated: shownLines < lines,
        height: shownLines * metrics.lineHeight,
    };
}

// ---------------------------------------------------------------------------
// 渲染、排版、回调 onLayout
// ---------------------------------------------------------------------------

/** 比较位置时的容差（dp），抵消按物理像素取整带来的误差 */
const EPSILON = 0.5;

function buildNode(json, config, env, records, parentPath) {
    const where = `${parentPath}/${json.type}`;
    const node = Yoga.Node.create(config);
    const props = json.props ?? {};
    const record = {
        type: json.type,
        props,
        path: where,
        yoga: node,
        children: [],
        text: null,
        textInfo: null,
        scroll: null,
    };
    records.push(record);

    if (json.type === 'Text') {
        if (props.adjustsFontSizeToFit) {
            throw new Error(`adjustsFontSizeToFit is not modelled (${where})`);
        }
        applyStyle(node, flattenStyle(props.style), where);
        const text = textContent(json.children);
        const metrics = textMetrics(props, env);
        record.text = text;
        record.metrics = metrics;
        node.setMeasureFunc((width, widthMode) => {
            const maxWidth =
                widthMode === MeasureMode.Undefined ? Infinity : width;
            const info = measureText(text, metrics, maxWidth, props.numberOfLines);
            return {
                width: widthMode === MeasureMode.Exactly ? width : info.width,
                height: info.height,
            };
        });
        return record;
    }

    if (json.type === 'TextInput') {
        const style = flattenStyle(props.style);
        if (props.multiline && style.height === undefined) {
            throw new Error(`A multiline TextInput needs an explicit height (${where})`);
        }
        applyStyle(node, style, where);
        const metrics = textMetrics(props, env);
        node.setMeasureFunc((width, widthMode) => ({
            width: widthMode === MeasureMode.Undefined ? 0 : width,
            height: metrics.lineHeight,
        }));
        return record;
    }

    if (json.type === 'Image') {
        const style = flattenStyle(props.style);
        const sized =
            (style.width !== undefined && style.height !== undefined) ||
            (style.aspectRatio !== undefined &&
                (style.width !== undefined || style.height !== undefined)) ||
            (style.position === 'absolute' &&
                style.left !== undefined &&
                style.right !== undefined &&
                style.top !== undefined &&
                style.bottom !== undefined);
        if (!sized) {
            throw new Error(`Image without a size at ${where}; give its stub or style one`);
        }
        applyStyle(node, style, where);
        return record;
    }

    if (json.type === 'ScrollView') {
        // RN 的 ScrollView：外层按样式排；里层内容容器在滚动方向上不受限
        // ScrollView.js 自带的基础样式（baseVertical / baseHorizontal）在前，传入的样式在后
        const horizontal = !!props.horizontal;
        applyStyle(
            node,
            {
                flexGrow: 1,
                flexShrink: 1,
                flexDirection: horizontal ? 'row' : 'column',
                ...flattenStyle(props.style),
            },
            where,
        );
        node.setOverflow(Overflow.Scroll);
        const content = Yoga.Node.create(config);
        applyStyle(
            content,
            {
                ...(horizontal ? {flexDirection: 'row'} : null),
                ...flattenStyle(props.contentContainerStyle),
            },
            `${where}/content`,
        );
        node.insertChild(content, 0);
        const contentRecord = {
            type: 'ScrollContent',
            props: {style: props.contentContainerStyle},
            path: `${where}/content`,
            yoga: content,
            children: [],
            text: null,
            textInfo: null,
            scroll: horizontal ? 'horizontal' : 'vertical',
        };
        records.push(contentRecord);
        record.children.push(contentRecord);
        contentRecord.parent = record;
        record.scroll = horizontal ? 'horizontal' : 'vertical';
        appendChildren(json.children, content, contentRecord, config, env, records, `${where}/content`);
        return record;
    }

    if (json.type !== 'View') {
        throw new Error(`Unknown host component "${json.type}" at ${where}`);
    }

    applyStyle(node, flattenStyle(props.style), where);
    appendChildren(json.children, node, record, config, env, records, where);
    return record;
}

function appendChildren(children, node, record, config, env, records, where) {
    let index = 0;
    for (const child of children ?? []) {
        if (child === null || typeof child !== 'object') {
            if (String(child).trim()) {
                throw new Error(`Raw text "${child}" outside <Text> at ${where}`);
            }
            continue;
        }
        const childRecord = buildNode(child, config, env, records, `${where}[${index}]`);
        childRecord.parent = record;
        node.insertChild(childRecord.yoga, node.getChildCount());
        record.children.push(childRecord);
        index += 1;
    }
}

function collectFrames(record, originX, originY) {
    const layout = record.yoga.getComputedLayout();
    record.local = {
        x: layout.left,
        y: layout.top,
        width: layout.width,
        height: layout.height,
    };
    record.frame = {
        x: originX + layout.left,
        y: originY + layout.top,
        width: layout.width,
        height: layout.height,
    };
    if (record.type === 'Text') {
        // 按最终宽度重算一次：Yoga 会用不同约束反复测量，最后一次不一定是最终结果
        const node = record.yoga;
        const contentWidth =
            layout.width -
            node.getComputedPadding(Edge.Left) -
            node.getComputedPadding(Edge.Right) -
            node.getComputedBorder(Edge.Left) -
            node.getComputedBorder(Edge.Right);
        const contentHeight =
            layout.height -
            node.getComputedPadding(Edge.Top) -
            node.getComputedPadding(Edge.Bottom) -
            node.getComputedBorder(Edge.Top) -
            node.getComputedBorder(Edge.Bottom);
        const info = measureText(
            record.text,
            record.metrics,
            contentWidth,
            record.props.numberOfLines,
        );
        record.textInfo = {
            ...info,
            // 分到的高度装不下要显示的行：多出来的部分会被裁掉
            clippedVertically: contentHeight + EPSILON < info.height,
            // 宽度连一个字都放不下（被挤成一条缝）
            squeezed:
                record.text.length > 0 &&
                contentWidth + EPSILON <
                    Math.min(info.naturalWidth, record.metrics.fontSize),
        };
    }
    for (const child of record.children) {
        collectFrames(child, record.frame.x, record.frame.y);
    }
}

/**
 * 渲染并排版到 width × height 的根容器里（相当于 RN 的根视图）。
 *
 * @returns {{root: object, renderer: object, passes: number}}
 */
export function renderLayout(element, {env, width, height, maxPasses = 8}) {
    const config = Yoga.Config.create();
    config.setErrata(Errata.All);
    config.setPointScaleFactor(env.window.scale);
    try {
        return settle(element, {env, width, height, maxPasses, config});
    } finally {
        config.free();
    }
}

function settle(element, {env, width, height, maxPasses, config}) {
    let renderer;
    TestRenderer.act(() => {
        renderer = TestRenderer.create(element);
    });
    const reported = new Map();

    for (let pass = 1; pass <= maxPasses; pass += 1) {
        const json = renderer.toJSON();
        const records = [];
        const rootNode = Yoga.Node.create(config);
        rootNode.setWidth(width);
        rootNode.setHeight(height);
        const root = {
            type: 'Root',
            props: {},
            path: 'root',
            yoga: rootNode,
            children: [],
            text: null,
            textInfo: null,
            scroll: null,
        };
        appendChildren(
            Array.isArray(json) ? json : json ? [json] : [],
            rootNode,
            root,
            config,
            env,
            records,
            'root',
        );
        rootNode.calculateLayout(width, height, Direction.LTR);
        collectFrames(root, 0, 0);
        rootNode.freeRecursive();

        const callbacks = [];
        for (const record of records) {
            const onLayout = record.props.onLayout;
            if (typeof onLayout !== 'function') {
                continue;
            }
            const signature = Object.values(record.local)
                .map(value => value.toFixed(2))
                .join(',');
            if (reported.get(record.path) !== signature) {
                reported.set(record.path, signature);
                const layout = {...record.local};
                callbacks.push(() => onLayout({nativeEvent: {layout}}));
            }
        }
        if (!callbacks.length) {
            return {
                root,
                renderer,
                passes: pass,
                unmount() {
                    TestRenderer.act(() => renderer.unmount());
                },
            };
        }
        TestRenderer.act(() => {
            callbacks.forEach(callback => callback());
        });
    }
    throw new Error(`Layout did not settle within ${maxPasses} passes`);
}

// ---------------------------------------------------------------------------
// 查询与断言辅助
// ---------------------------------------------------------------------------

export function findAll(record, predicate, out = []) {
    if (predicate(record)) {
        out.push(record);
    }
    for (const child of record.children) {
        findAll(child, predicate, out);
    }
    return out;
}

export function findOne(record, predicate, what) {
    const found = findAll(record, predicate);
    if (found.length !== 1) {
        throw new Error(`Expected exactly one ${what}, found ${found.length}`);
    }
    return found[0];
}

export const byTestID = id => record => record.props.testID === id;
export const byText = text => record => record.type === 'Text' && record.text === text;
export const isText = record => record.type === 'Text';

/**
 * inner 是否完整落在 outer 里。默认容差 0.5 dp，抵消按像素取整；文字框的宽度
 * 会向上取整到像素（RN 也这样，免得最后一个字被截），比较文字和它的父视图时
 * 要放宽到 1 dp。
 */
export function contains(outer, inner, tolerance = EPSILON) {
    return (
        inner.x >= outer.x - tolerance &&
        inner.y >= outer.y - tolerance &&
        inner.x + inner.width <= outer.x + outer.width + tolerance &&
        inner.y + inner.height <= outer.y + outer.height + tolerance
    );
}

function containsAlong(outer, inner, axis) {
    const [start, size] = axis === 'x' ? ['x', 'width'] : ['y', 'height'];
    return (
        inner[start] >= outer[start] - EPSILON &&
        inner[start] + inner[size] <= outer[start] + outer[size] + EPSILON
    );
}

/**
 * 最近一个会把 record 裁掉一部分的祖先，没有就是 null：
 * - overflow: hidden 的祖先两个方向都裁；
 * - 滚动容器只在不能滚动的方向上裁（竖向列表裁左右，横向列表裁上下）。
 */
export function clippingAncestor(record) {
    for (let ancestor = record.parent; ancestor; ancestor = ancestor.parent) {
        const style = flattenStyle(ancestor.props.style);
        if (style.overflow === 'hidden' && !contains(ancestor.frame, record.frame)) {
            return ancestor;
        }
        if (
            ancestor.type === 'ScrollView' &&
            !containsAlong(
                ancestor.frame,
                record.frame,
                ancestor.scroll === 'vertical' ? 'x' : 'y',
            )
        ) {
            return ancestor;
        }
    }
    return null;
}

export function describeFrame(frame) {
    return `x=${frame.x.toFixed(1)} y=${frame.y.toFixed(1)} w=${frame.width.toFixed(1)} h=${frame.height.toFixed(1)}`;
}

/** 调试用：按层级打印排版结果（类型、位置、文字） */
export function dumpTree(record, maxDepth = Infinity, depth = 0, lines = []) {
    if (depth > maxDepth) {
        return lines;
    }
    const label = record.props.accessibilityLabel
        ? ` [${record.props.accessibilityLabel}]`
        : '';
    const text = record.text !== null ? ` "${record.text}"` : '';
    lines.push(
        `${'  '.repeat(depth)}${record.type}${label}${text} ${record.frame ? describeFrame(record.frame) : ''}`,
    );
    for (const child of record.children) {
        dumpTree(child, maxDepth, depth + 1, lines);
    }
    return lines;
}

// 插件用户变量、Last.fm、WebDAV 共用的表单（SetUserVariables）：名称、说明要完整
// 显示，输入框占满一行，说明紧跟在自己的输入框下面、不压到下一项。
// 以前名称和输入框挤在一行，名称最多占 35%、说明塞在占位文字里，两者都被截断。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    React,
    clippingAncestor,
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
const CONTENT_PADDING = 16;

function createFormStubs(env) {
    return {
        ...createCommonStubs(env),
        '@/native/utils': strictStub('@/native/utils', {
            default: {getWindowDimensions: () => env.window},
        }),
    };
}

/** 真实页面传进来的几组变量：插件（名称、说明都偏长）、WebDAV、Last.fm */
function formsOf(t) {
    return [
        {
            name: 'plugin',
            title: t('panel.setUserVariables.title'),
            variables: [
                {
                    key: 'source',
                    name: '音源接口地址（自建或公共接口均可）',
                    hint: '填写完整地址，例如 https://example.com/api ；留空则使用插件内置的公共接口，高峰期可能较慢',
                },
                {
                    key: 'token',
                    name: 'access_token_for_premium_streaming_endpoint',
                    hint: 'Key 无效或已被删除时接口会返回 403，请到接口提供方重新申请',
                    secureTextEntry: true,
                },
                {key: 'quality', name: '默认音质'},
            ],
        },
        {
            name: 'webdav',
            title: t('backupAndResume.webdavSettings'),
            variables: [
                {key: 'url', name: 'URL', hint: t('backupAndResume.webdavUrl')},
                {key: 'username', name: t('common.username')},
                {
                    key: 'password',
                    name: t('common.password'),
                    hint: t('backupAndResume.webdavPasswordStoredHint'),
                    secureTextEntry: true,
                },
            ],
        },
        {
            name: 'last.fm',
            title: t('lastfm.credentials'),
            variables: [
                {key: 'apiKey', name: 'API Key', hint: t('lastfm.credentialsHint')},
                {key: 'apiSecret', name: 'API Secret', hint: t('lastfm.secretStoredHint')},
            ],
        },
    ];
}

function renderForm(env, pickForm) {
    const loader = createModuleLoader(createFormStubs(env));
    const SetUserVariables = loader.load(
        '@/components/panels/types/setUserVariables',
    ).default;
    const {t} = loader.load('@/core/i18n').default;
    const form = pickForm(formsOf(t));
    const {width, height} = env.window;
    const panel = inAppFontScaleScope(
        loader,
        {panel: 'SetUserVariables'},
        h(SetUserVariables, {
            title: form.title,
            variables: form.variables,
            onOk() {},
        }),
    );
    const rendered = renderLayout(panel, {env, width, height});
    return {...rendered, form, t};
}

function assertShownInFull(text, bounds, what) {
    assert.ok(text, `${what} is rendered`);
    assert.ok(!text.textInfo.truncated, `${what} is not cut short`);
    assert.ok(!text.textInfo.squeezed, `${what} has room`);
    assert.ok(!text.textInfo.clippedVertically, `${what} is not cut off`);
    assert.equal(clippingAncestor(text), null, `${what} ${describeFrame(text.frame)} is not clipped`);
    assert.ok(
        text.frame.x >= bounds.left - 0.5 &&
            text.frame.x + text.frame.width <= bounds.right + 1,
        `${what} ${describeFrame(text.frame)} stays between x=${bounds.left} and x=${bounds.right}`,
    );
}

const DEVICES = [
    {name: '320×640', width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {name: "the user's phone 363×806", width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
    {name: 'landscape 806×363', width: 806, height: 363, scale: 3.5, insets: {top: 24, right: 0, bottom: 0, left: 0}},
];

for (const device of DEVICES) {
    for (const language of ['zh-CN', 'en-US']) {
        for (const fontScale of [1, 1.3, 2]) {
            for (const formName of ['plugin', 'webdav', 'last.fm']) {
                test(`${formName} form on ${device.name}, ${language}, font scale ${fontScale}`, () => {
                    const env = createEnv({...device, fontScale, language});
                    const {root, form, t, unmount} = renderForm(env, forms =>
                        forms.find(item => item.name === formName),
                    );
                    try {
                        const scroll = findOne(root, record => record.type === 'ScrollView', 'form scroll view');
                        const content = scroll.children[0];
                        const bounds = {
                            left: content.frame.x + CONTENT_PADDING,
                            right: content.frame.x + content.frame.width - CONTENT_PADDING,
                        };
                        assert.ok(bounds.right - bounds.left > 200, 'the form is not squeezed');

                        // 面板标题和两侧按钮：按钮文字一行放下，不和标题重叠
                        const cancel = findOne(root, record => isText(record) && record.text === t('common.cancel'), 'cancel');
                        const confirm = findOne(root, record => isText(record) && record.text === t('common.confirm'), 'confirm');
                        const title = findOne(root, record => isText(record) && record.text === form.title, 'title');
                        for (const [what, text] of [['cancel', cancel], ['confirm', confirm]]) {
                            assert.equal(text.textInfo.neededLines, 1, `${what} fits on one line`);
                            assert.equal(clippingAncestor(text), null, `${what} is not clipped`);
                        }
                        // 比较按钮本身（文字会被拉伸到按钮宽）；文字框按像素取整，放宽到 1 dp
                        assert.ok(
                            cancel.parent.frame.x + cancel.parent.frame.width <= title.frame.x + 1 &&
                                title.frame.x + title.frame.width <= confirm.parent.frame.x + 1,
                            `header buttons ${describeFrame(cancel.parent.frame)} ${describeFrame(confirm.parent.frame)} and title ${describeFrame(title.frame)} do not overlap`,
                        );

                        const fields = form.variables.map(variable => {
                            const label = findOne(
                                content,
                                record => isText(record) && record.text === variable.name,
                                `label "${variable.name}"`,
                            );
                            const field = label.parent;
                            const input = findOne(field, record => record.type === 'TextInput', `input for ${variable.key}`);
                            const hint = variable.hint
                                ? findOne(field, record => isText(record) && record.text === variable.hint, `hint for ${variable.key}`)
                                : null;
                            return {variable, field, label, input, hint};
                        });

                        let previousBottom = -Infinity;
                        for (const {variable, field, label, input, hint} of fields) {
                            assertShownInFull(label, bounds, `label "${variable.name}"`);
                            // 输入框占满一行，高度够点
                            assert.ok(
                                Math.abs(input.frame.x - bounds.left) <= 0.5 &&
                                    Math.abs(input.frame.x + input.frame.width - bounds.right) <= 0.5,
                                `input for ${variable.key} ${describeFrame(input.frame)} spans the form`,
                            );
                            assert.ok(
                                input.frame.height >= 44 - 0.5,
                                `input for ${variable.key} ${describeFrame(input.frame)} is at least 44 dp tall`,
                            );
                            assert.ok(label.frame.y + label.frame.height <= input.frame.y + 0.5, 'label above its input');
                            if (hint) {
                                assertShownInFull(hint, bounds, `hint for ${variable.key}`);
                                assert.ok(input.frame.y + input.frame.height <= hint.frame.y + 0.5, 'hint below its input');
                            }
                            // 各项依次往下排，不互相压住
                            assert.ok(field.frame.y >= previousBottom - 0.5, `field ${variable.key} starts below the previous one`);
                            previousBottom = field.frame.y + field.frame.height;
                        }
                        assert.equal(findAll(content, isText).length, fields.length + fields.filter(f => f.hint).length);
                    } finally {
                        unmount();
                    }
                });
            }
        }
    }
}

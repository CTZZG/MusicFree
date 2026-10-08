// 歌曲批量编辑、歌单编辑的保存按钮：以前通过 actionComponent 传入旧的 IconButton，
// 能点的只有图标那么大；现在和其他导航栏按钮一样 44 宽、整栏高。没有改动可保存时
// 变淡、点了没反应，读屏也说明不可用。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {React, createModuleLoader, describeFrame, findOne, renderLayout, strictStub} from './harness.mjs';
import {createEnv, createPageStubs} from './stubs.mjs';

const h = React.createElement;
const noop = () => {};

const DEVICES = [
    {name: '320×640', width: 320, height: 640, scale: 2, insets: {top: 24, right: 0, bottom: 48, left: 0}},
    {name: "the user's phone 363×806", width: 363, height: 806, scale: 3.5, insets: {top: 36, right: 0, bottom: 20, left: 0}},
];
const MIN_TARGET = 44;

function stubsFor(env, atoms, extra) {
    return {
        ...createPageStubs(env, {params: {musicSheet: {id: 'sheet-1', title: '我的歌单'}}}),
        '@react-navigation/native': strictStub('@react-navigation/native', {
            useNavigation: () => ({goBack: noop}),
            useTheme: () => ({dark: false}),
        }),
        '@/components/base/statusBar': strictStub('statusBar', {default: () => null}),
        jotai: strictStub('jotai', {useAtomValue: atom => atoms.get(atom)}),
        ...extra,
    };
}

function saveButton(root, t) {
    return findOne(root, record => record.props.accessibilityLabel === t('common.save'), 'save button');
}

function assertEasyToHit(button, device) {
    assert.ok(button.frame.width >= MIN_TARGET - 0.5 && button.frame.height >= MIN_TARGET - 0.5,
        `save button is at least ${MIN_TARGET} dp square: ${describeFrame(button.frame)}`);
    assert.ok(button.frame.x + button.frame.width <= device.width + 0.5, 'save button stays on screen');
}

function renderMusicListEditor(env, isDirty) {
    const changed = Symbol('musicListChanged');
    const saved = [];
    const loader = createModuleLoader(stubsFor(env, new Map([[changed, isDirty]]), {
        '@/pages/musicListEditor/store/atom': strictStub('musicListEditor atoms', {musicListChangedAtom: changed}),
        '@/pages/musicListEditor/store/action': strictStub('musicListEditor actions', {
            saveEditingMusicList: async id => saved.push(id),
        }),
    }));
    const NavBar = loader.load('@/pages/musicListEditor/components/navBar').default;
    const rendered = renderLayout(h(NavBar), {env, width: env.window.width, height: env.window.height});
    return {...rendered, saved, t: loader.load('@/core/i18n').default.t};
}

function renderSheetEditor(env, {changed, ready = true, saving = false}) {
    const atoms = {
        musicSheetChangedAtom: Symbol('changed'),
        sheetEditorReadyAtom: Symbol('ready'),
        sheetEditorSavingAtom: Symbol('saving'),
        sheetTypeAtom: Symbol('type'),
    };
    const values = new Map([
        [atoms.musicSheetChangedAtom, changed],
        [atoms.sheetEditorReadyAtom, ready],
        [atoms.sheetEditorSavingAtom, saving],
        [atoms.sheetTypeAtom, 'local'],
    ]);
    const saves = [];
    const loader = createModuleLoader(stubsFor(env, values, {
        '@/pages/sheetEditor/store/atom': strictStub('sheetEditor atoms', atoms),
        '@/pages/sheetEditor/store/action': strictStub('sheetEditor actions', {beginSheetTypeChange: noop}),
        '@/pages/sheetEditor/store/transition': strictStub('sheetEditor transition', {
            confirmSheetEditorTransition: noop,
            saveEditingMusicSheetWithFeedback: async () => saves.push('save'),
        }),
    }));
    const NavBar = loader.load('@/pages/sheetEditor/components/navBar').default;
    const rendered = renderLayout(h(NavBar), {env, width: env.window.width, height: env.window.height});
    return {...rendered, saves, t: loader.load('@/core/i18n').default.t};
}

for (const device of DEVICES) {
    for (const language of ['zh-CN', 'en-US']) {
        const where = `${device.name}, ${language}`;

        test(`song list editor: save is a full-size bar button, ${where}`, async () => {
            for (const isDirty of [false, true]) {
                const env = createEnv({...device, language});
                const {root, unmount, saved, t} = renderMusicListEditor(env, isDirty);
                try {
                    const button = saveButton(root, t);
                    assertEasyToHit(button, device);
                    assert.equal(button.props.disabled, !isDirty, `save is ${isDirty ? 'enabled' : 'disabled'} when the list ${isDirty ? 'changed' : 'did not change'}`);
                    assert.deepEqual(button.props.accessibilityState, {disabled: !isDirty});
                    if (isDirty) {
                        await button.props.onPress();
                        assert.deepEqual(saved, ['sheet-1']);
                    }
                } finally {
                    unmount();
                }
            }
        });

        test(`sheet editor: save is a full-size bar button, ${where}`, async () => {
            const cases = [
                {state: {changed: false}, canSave: false},
                {state: {changed: true, ready: false}, canSave: false},
                {state: {changed: true, saving: true}, canSave: false},
                {state: {changed: true}, canSave: true},
            ];
            for (const {state, canSave} of cases) {
                const env = createEnv({...device, language});
                const {root, unmount, saves, t} = renderSheetEditor(env, state);
                try {
                    const button = saveButton(root, t);
                    assertEasyToHit(button, device);
                    assert.equal(button.props.disabled, !canSave, `save ${canSave ? 'works' : 'is disabled'} for ${JSON.stringify(state)}`);
                    if (canSave) {
                        await button.props.onPress();
                        assert.deepEqual(saves, ['save']);
                    }
                } finally {
                    unmount();
                }
            }
        });
    }
}

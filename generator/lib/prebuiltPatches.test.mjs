// 带预编译 AAR 的 expo 模块打 Android 补丁时，没写进 buildFromSource 就白打（见 prebuiltPatches.mjs）。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    buildsFromSource,
    ignoredPrebuiltPatches,
    packageNameOfPatch,
    touchesAndroidSources,
} from './prebuiltPatches.mjs';

const androidPatch = name =>
    `diff --git a/node_modules/${name}/android/src/main/java/Foo.kt b/node_modules/${name}/android/src/main/java/Foo.kt\n` +
    'index 1..2 100644\n';
const jsPatch = name =>
    `diff --git a/node_modules/${name}/build/index.js b/node_modules/${name}/build/index.js\n`;
const prebuilt = {android: {publication: {artifactId: 'expo.modules.splashscreen'}}};
const configs = {
    'expo-splash-screen': prebuilt,
    'expo-liquid-glass-native': {android: {modules: ['X']}},
};
const moduleConfigOf = name => configs[name] ?? null;

test('reads package names from patch-package file names', () => {
    assert.equal(packageNameOfPatch('expo-splash-screen+56.0.14.patch'), 'expo-splash-screen');
    assert.equal(packageNameOfPatch('@jimp+core+0.22.12.patch'), '@jimp/core');
    assert.equal(packageNameOfPatch('react-native+0.85.3.patch'), 'react-native');
    assert.equal(packageNameOfPatch('README.md'), null);
    assert.equal(packageNameOfPatch('outer++inner+1.0.0.patch'), null);
});

test('only counts diffs under the package android directory', () => {
    assert.ok(touchesAndroidSources(androidPatch('expo-splash-screen'), 'expo-splash-screen'));
    assert.ok(!touchesAndroidSources(jsPatch('expo-splash-screen'), 'expo-splash-screen'));
    assert.ok(!touchesAndroidSources(androidPatch('expo-splash-screen-extra'), 'expo-splash-screen'));
});

test('buildFromSource patterns match the whole project name', () => {
    assert.ok(buildsFromSource('expo-splash-screen', ['expo-splash-screen']));
    assert.ok(buildsFromSource('expo-splash-screen', ['expo-.*']));
    assert.ok(!buildsFromSource('expo-splash-screen', ['expo']));
    assert.ok(!buildsFromSource('expo-splash-screen', ['[']));
    assert.ok(!buildsFromSource('expo-splash-screen', undefined));
});

test('flags an Android patch on a prebuilt expo module that is not built from source', () => {
    const patches = [{fileName: 'expo-splash-screen+56.0.14.patch', text: androidPatch('expo-splash-screen')}];
    const problems = ignoredPrebuiltPatches({patches, moduleConfigOf, buildFromSource: []});
    assert.equal(problems.length, 1);
    assert.match(problems[0], /expo-splash-screen\+56\.0\.14\.patch: expo-splash-screen is linked from its prebuilt AAR/);
    assert.deepEqual(
        ignoredPrebuiltPatches({patches, moduleConfigOf, buildFromSource: ['expo-splash-screen']}),
        [],
    );
});

test('ignores modules without a prebuilt AAR and patches outside android', () => {
    const patches = [
        {fileName: 'expo-liquid-glass-native+1.3.16.patch', text: androidPatch('expo-liquid-glass-native')},
        {fileName: 'react-native+0.85.3.patch', text: androidPatch('react-native')},
        {fileName: 'expo-splash-screen+56.0.14.patch', text: jsPatch('expo-splash-screen')},
    ];
    assert.deepEqual(ignoredPrebuiltPatches({patches, moduleConfigOf, buildFromSource: []}), []);
});

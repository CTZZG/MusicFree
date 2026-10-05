// PR 检查只在原生相关改动时跑 Android 单元测试。判断错了的代价不对称：
// 多跑一次只是慢几分钟，漏跑会让坏掉的原生测试混进来，所以拿不准就跑。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {nativeRelatedPaths, resolveDiffBase} from './nativeChanges.mjs';

test('picks up native code, native dependencies and this check itself', () => {
    assert.deepEqual(
        nativeRelatedPaths([
            'android/app/src/main/java/fun/upup/musicfree/qmc/QmcCipher.kt',
            'android/app/build.gradle',
            'patches/react-native+0.85.3.patch',
            'package-lock.json',
            'package.json',
            'app.json',
            '.github/workflows/ci.yml',
            'generator/lib/nativeChanges.mjs',
        ]).length,
        8,
    );
});

test('skips changes that cannot affect the native build', () => {
    assert.deepEqual(
        nativeRelatedPaths([
            'src/pages/home/components/homeBody/homeOverview.tsx',
            'docs/architecture.md',
            'generator/verify.mjs',
            '.github/workflows/build-beta.yml',
            'android-build-info.txt',
        ]),
        [],
    );
});

test('compares a pull request with its target branch', () => {
    assert.equal(resolveDiffBase({eventName: 'pull_request'}), 'HEAD^1');
});

test('compares a push with the commit before it', () => {
    assert.equal(
        resolveDiffBase({eventName: 'push', beforeSha: 'abc123'}),
        'abc123',
    );
});

test('runs the tests when there is nothing to compare with', () => {
    // 新建分支时 before 是全 0；手动触发没有 before
    assert.equal(
        resolveDiffBase({
            eventName: 'push',
            beforeSha: '0000000000000000000000000000000000000000',
        }),
        null,
    );
    assert.equal(resolveDiffBase({eventName: 'push'}), null);
    assert.equal(resolveDiffBase({eventName: 'workflow_dispatch'}), null);
    assert.equal(resolveDiffBase({}), null);
});

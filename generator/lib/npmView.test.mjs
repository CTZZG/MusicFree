// 生产依赖审计靠 npm view 判断「上游有没有修复版」。查询失败时以前会被当成
// 「没有版本」，于是例外照样放行；这些用例锁住只有确定没有匹配版本时才返回空。
// 输出样例取自 npm 10.9.4。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseNpmViewVersions} from './npmView.mjs';

const spec = 'braces@>3.0.3 ^3.0.2';

test('returns the versions npm found', () => {
    assert.deepEqual(
        parseNpmViewVersions(spec, {status: 0, stdout: '["3.0.2","3.0.3"]'}),
        ['3.0.2', '3.0.3'],
    );
    assert.deepEqual(
        parseNpmViewVersions(spec, {status: 0, stdout: '"3.0.3"'}),
        ['3.0.3'],
    );
});

test('treats an explicit no-match answer as no versions', () => {
    const stdout = JSON.stringify({
        error: {code: 'E404', summary: 'No match found for version >99'},
    });
    assert.deepEqual(parseNpmViewVersions(spec, {status: 1, stdout}), []);
    assert.deepEqual(parseNpmViewVersions(spec, {status: 0, stdout: ''}), []);
});

test('fails on a network error instead of reporting no fix', () => {
    const stdout = JSON.stringify({
        error: {code: 'ECONNREFUSED', summary: 'FetchError: connect ECONNREFUSED'},
    });
    assert.throws(
        () => parseNpmViewVersions(spec, {status: 1, stdout}),
        /ECONNREFUSED/,
    );
});

test('fails when the package itself is missing from the registry', () => {
    const stdout = JSON.stringify({
        error: {code: 'E404', summary: 'Not Found - GET https://registry.npmjs.org/braces'},
    });
    assert.throws(() => parseNpmViewVersions(spec, {status: 1, stdout}), /Not Found/);
});

test('fails when npm exits without any output or is killed', () => {
    assert.throws(
        () => parseNpmViewVersions(spec, {status: 1, stdout: '', stderr: 'npm error network'}),
        /exit 1.*npm error network/,
    );
    assert.throws(
        () => parseNpmViewVersions(spec, {status: null, signal: 'SIGTERM', stdout: ''}),
        /signal SIGTERM/,
    );
});

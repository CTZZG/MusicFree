import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'musicfree-eslint-ratchet-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    fs.mkdirSync(path.join(root, 'generator/lib'), {recursive: true});
    for (const name of ['generator/eslint-ratchet.mjs', 'generator/lib/eslintRatchet.mjs']) {
        fs.copyFileSync(path.join(repoRoot, name), path.join(root, name));
    }
    fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'junction');
    fs.writeFileSync(path.join(root, 'package.json'), '{"private":true}');
    fs.writeFileSync(path.join(root, '.eslintrc.json'), JSON.stringify({
        root: true,
        env: {es2022: true, node: true},
        ignorePatterns: ['generator/**'],
        rules: {quotes: ['warn', 'single'], 'no-void': 'warn'},
    }));
    const baseline = path.join(root, 'generator/eslint-warning-baseline.json');
    fs.writeFileSync(baseline, '{ "quotes": 2 }\n');
    const original = fs.readFileSync(baseline, 'utf8');
    const write = code => fs.writeFileSync(path.join(root, 'sample.js'), code);
    const run = (...args) => spawnSync(process.execPath, ['generator/eslint-ratchet.mjs', ...args], {
        cwd: root,
        encoding: 'utf8',
    });
    return {baseline, original, write, run};
}

test('a parse error rejects updates without changing any baseline bytes', t => {
    const f = fixture(t);
    f.write('const a = "one";\nconst b = "two";\n');
    assert.equal(f.run().status, 0);
    f.write('const a = "one";\nconst b = "two";\nconst broken = ;\n');
    assert.equal(f.run('--update').status, 1);
    assert.equal(fs.readFileSync(f.baseline, 'utf8'), f.original);
    f.write('const a = "one";\nconst b = "two";\n');
    assert.equal(f.run().status, 0);
});

test('a new warning rejects updates even if another rule improved', t => {
    const f = fixture(t);
    f.write('const a = "one";\nvoid 0;\n');
    assert.equal(f.run('--update').status, 1);
    assert.equal(fs.readFileSync(f.baseline, 'utf8'), f.original);
});

test('a valid improvement is written and passes the next check', t => {
    const f = fixture(t);
    f.write('const a = "one";\n');
    assert.equal(f.run('--update').status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.baseline, 'utf8')), {quotes: 1});
    assert.equal(f.run().status, 0);
});

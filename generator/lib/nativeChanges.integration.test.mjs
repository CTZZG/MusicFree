import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const detector = fileURLToPath(new URL('../detect-native-changes.mjs', import.meta.url));

function repository(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'musicfree-native-changes-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
    const write = (name, content = 'package example\nclass PlaybackState\n') => {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, content);
    };
    const commit = () => {
        git('add', '--all');
        git('-c', 'user.name=Layout tests', '-c', 'user.email=tests@example.invalid', 'commit', '-qm', 'fixture');
        return git('rev-parse', 'HEAD');
    };
    git('init', '-q');
    write('android/PlaybackState.kt');
    const base = commit();
    return {root, git, write, commit, base};
}

function detect(repo, eventName = 'push', base = repo.base) {
    const output = path.join(repo.root, 'github-output');
    fs.writeFileSync(output, '');
    const result = spawnSync(process.execPath, [detector], {
        cwd: repo.root,
        encoding: 'utf8',
        env: {...process.env, GITHUB_EVENT_NAME: eventName, BEFORE_SHA: base, GITHUB_OUTPUT: output},
    });
    assert.equal(result.status, 0, result.stderr);
    return fs.readFileSync(output, 'utf8');
}

test('a rename out of android runs native tests for push and PR comparisons', t => {
    const repo = repository(t);
    fs.mkdirSync(path.join(repo.root, 'docs'));
    repo.git('mv', 'android/PlaybackState.kt', 'docs/PlaybackState.kt');
    repo.commit();
    assert.match(repo.git('diff', '--name-status', repo.base, 'HEAD'), /^R100/);
    assert.equal(detect(repo), 'native=true\n');
    assert.equal(detect(repo, 'pull_request'), 'native=true\n');
});

test('native filenames with spaces, Unicode and newlines are not quoted away', t => {
    const repo = repository(t);
    repo.write(process.platform === 'win32'
        ? 'android/播放 状态测试.kt'
        : 'android/播放 状态\n测试.kt');
    repo.commit();
    assert.equal(detect(repo), 'native=true\n');
});

test('a documentation-only change skips native tests', t => {
    const repo = repository(t);
    repo.write('docs/notes.md', 'notes\n');
    repo.commit();
    assert.equal(detect(repo), 'native=false\n');
});

test('an invalid comparison base still runs native tests', t => {
    const repo = repository(t);
    assert.equal(detect(repo, 'push', 'missing-revision'), 'native=true\n');
});

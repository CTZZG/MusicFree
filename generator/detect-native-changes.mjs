// CI 用：判断这次改动要不要跑 Android 单元测试，结果写入 GITHUB_OUTPUT 的 native=true/false。
// 判断规则见 lib/nativeChanges.mjs；无法比较时按「要跑」处理。
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {nativeRelatedPaths, resolveDiffBase} from './lib/nativeChanges.mjs';

const base = resolveDiffBase({
    eventName: process.env.GITHUB_EVENT_NAME,
    beforeSha: process.env.BEFORE_SHA,
});

let native = true;
let reason;
if (!base) {
    reason = 'No comparable base (manual run or new branch); running the tests.';
} else {
    try {
        const output = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], {
            encoding: 'utf8',
        });
        const changed = output.split('\n').filter(Boolean);
        const related = nativeRelatedPaths(changed);
        native = related.length > 0;
        reason = native
            ? `Native-related changes:\n${related.map(path => `  ${path}`).join('\n')}`
            : `No native-related changes among ${changed.length} changed files; skipping.`;
    } catch (error) {
        native = true;
        reason = `git diff against ${base} failed (${error.message}); running the tests.`;
    }
}

console.log(reason);
if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `native=${native}\n`);
}

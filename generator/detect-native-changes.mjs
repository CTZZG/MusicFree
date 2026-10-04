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
        // 重命名按删除＋新增处理，旧的原生路径也必须检查；NUL 分隔保留中文、
        // 空格和换行等文件名，不依赖 Git 的路径引号转义。
        const output = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, 'HEAD', '--'], {
            encoding: 'utf8',
        });
        const changed = output.split('\0').filter(Boolean);
        const related = nativeRelatedPaths(changed);
        native = related.length > 0;
        reason = native
            ? `Native-related changes:\n${related.map(path => `  ${JSON.stringify(path)}`).join('\n')}`
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

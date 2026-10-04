// verify 的 ESLint 步骤：有报错就失败；警告按规则与 generator/eslint-warning-baseline.json
// 比较，只许减少（规则见 lib/eslintRatchet.mjs）。
//
//   node generator/eslint-ratchet.mjs           检查，不改任何文件
//   node generator/eslint-ratchet.mjs --update  把基线降到当前的警告数（npm run lint:baseline），
//                                               不会提高任何一条
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
    NO_RULE,
    compareWithBaseline,
    countWarningsByRule,
    evaluate,
    parseBaseline,
    summarize,
    tightenBaseline,
} from './lib/eslintRatchet.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(rootDir, 'generator', 'eslint-warning-baseline.json');
const {ESLint} = createRequire(path.join(rootDir, 'package.json'))('eslint');

const update = process.argv.includes('--update');

// 与 npm run lint:check 检查同一批文件
const eslint = new ESLint({
    cwd: rootDir,
    extensions: ['.js', '.jsx', '.mjs', '.ts', '.tsx'],
});
const results = await eslint.lintFiles(['.']);
const stylish = await eslint.loadFormatter('stylish');
const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0);
const counts = countWarningsByRule(results);
const baseline = parseBaseline(JSON.parse(fs.readFileSync(baselinePath, 'utf8')));

const totalWarnings = Object.values(counts).reduce((sum, count) => sum + count, 0);
console.log(
    `ESLint: ${errorCount} error(s), ${totalWarnings} warning(s) in ${results.length} files`,
);
console.log('Warnings per rule (now / baseline):');
console.log(summarize(counts, baseline).join('\n'));

if (errorCount > 0) {
    console.log(await stylish.format(ESLint.getErrorResults(results)));
}

/** 只留下某些规则的警告，交给 stylish 输出 */
function warningsOf(rules) {
    return results
        .map(result => {
            const messages = result.messages.filter(
                message =>
                    message.severity === 1 && rules.has(message.ruleId ?? NO_RULE),
            );
            return {
                ...result,
                messages,
                errorCount: 0,
                fatalErrorCount: 0,
                warningCount: messages.length,
                fixableErrorCount: 0,
                fixableWarningCount: 0,
            };
        })
        .filter(result => result.messages.length);
}

const target = update ? tightenBaseline(counts, baseline) : baseline;
if (update) {
    fs.writeFileSync(baselinePath, `${JSON.stringify(target, null, 4)}\n`);
    console.log(`\nBaseline written to ${path.relative(rootDir, baselinePath)}.`);
}

const {ok, lines} = evaluate({errorCount, counts, baseline: target});
if (!ok) {
    // 超出基线的规则：列出它们的全部警告，方便找到新加的那几条
    const regressed = new Set(
        compareWithBaseline(counts, target).regressions.map(item => item.rule),
    );
    if (regressed.size) {
        console.log(await stylish.format(warningsOf(regressed)));
    }
    console.error(lines.join('\n'));
    process.exit(1);
}

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 基础质量门：本地 `npm run verify` 与 CI（稳定版、Beta、PR 检查）共用这一份清单，
// 任何 Android 构建之前都要先通过。检查只读，不会修改工作区文件。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const nodeCommand = process.execPath;

function nodeModule(...segments) {
    return path.join(rootDir, 'node_modules', ...segments);
}

// 构建脚本自己的 node:test 用例：generator/lib 下所有 *.test.mjs，新加的自动纳入
const generatorTestDir = path.join(rootDir, 'generator', 'lib');
const generatorTests = fs
    .readdirSync(generatorTestDir)
    .filter(name => name.endsWith('.test.mjs'))
    .sort()
    .map(name => path.join(generatorTestDir, name));

// 布局测试（Yoga）：tests/layout 下所有 *.test.mjs
const layoutTestDir = path.join(rootDir, 'tests', 'layout');
const layoutTests = fs
    .readdirSync(layoutTestDir)
    .filter(name => name.endsWith('.test.mjs'))
    .sort()
    .map(name => path.join(layoutTestDir, name));

const checks = [
    {
        // 格式样本矩阵、结构不变量、依赖覆盖审计与 TypeScript
        name: 'Static audits and TypeScript',
        args: [path.join(rootDir, 'generator', 'audit-round20-static.mjs')],
    },
    {
        name: 'ESLint (check only)',
        args: [
            nodeModule('eslint', 'bin', 'eslint.js'),
            '.',
            '--ext',
            '.js,.jsx,.mjs,.ts,.tsx',
        ],
    },
    {
        name: 'Jest',
        args: [nodeModule('jest', 'bin', 'jest.js'), '--runInBand'],
        // 构建任务在 job 级别设置 NODE_ENV=production，会让 Babel 移除 console，
        // 测试必须固定在 test 环境下运行。
        env: {NODE_ENV: 'test'},
    },
    {
        // 构建脚本自己的单元测试（node:test），例如审计里 npm view 结果的判定、
        // CI 是否需要跑原生测试的判定
        name: 'Generator unit tests',
        args: ['--test', ...generatorTests],
    },
    {
        // 渲染真实组件、用 Yoga 排版，检查播放页、歌单网格、设置表单在几种
        // 屏幕尺寸、系统字体缩放和语言下不重叠、不被裁掉
        name: 'Layout tests (Yoga)',
        args: ['--test', ...layoutTests],
        env: {NODE_ENV: 'test'},
    },
    {
        name: 'patch-package replay',
        // patch-package 没有 --check：未知参数被忽略，补丁打不上时本地只打印
        // 警告、退出码仍是 0（CI 上才默认报错）。--error-on-fail 让本地同样失败。
        args: [nodeModule('patch-package', 'index.js'), '--error-on-fail'],
    },
];

for (const check of checks) {
    console.log(`\n==> ${check.name}`);
    const result = spawnSync(nodeCommand, check.args, {
        cwd: rootDir,
        stdio: 'inherit',
        shell: false,
        env: {...process.env, ...check.env},
    });

    if (result.error) {
        console.error(`Failed to run ${check.name}: ${result.error.message}`);
        process.exit(1);
    }

    if (result.status !== 0) {
        console.error(`${check.name} failed with exit code ${result.status}`);
        process.exit(result.status ?? 1);
    }
}

console.log('\nAll quality gate checks passed.');

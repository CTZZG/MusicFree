import {spawnSync} from 'node:child_process';
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
        name: 'patch-package replay',
        args: [nodeModule('patch-package', 'index.js'), '--check'],
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

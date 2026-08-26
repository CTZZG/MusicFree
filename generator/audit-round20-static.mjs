import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const nodeCommand = process.execPath;
const formatSamplesAuditPath = path.join(
    rootDir,
    'generator',
    'audit-round20-format-samples.mjs',
);
const invariantsAuditPath = path.join(
    rootDir,
    'generator',
    'audit-invariants.mjs',
);
const dependencyOverridesAuditPath = path.join(
    rootDir,
    'generator',
    'audit-dependency-overrides.mjs',
);
const tscPath = path.join(
    rootDir,
    'node_modules',
    'typescript',
    'bin',
    'tsc',
);

const checks = [
    {
        name: 'Round 20 format sample matrix',
        command: nodeCommand,
        args: [formatSamplesAuditPath],
    },
    {
        name: 'Structural invariants',
        command: nodeCommand,
        args: [invariantsAuditPath],
    },
    {
        name: 'Dependency security overrides',
        command: nodeCommand,
        args: [dependencyOverridesAuditPath],
    },
    {
        name: 'TypeScript',
        command: nodeCommand,
        args: [tscPath, '--noEmit', '--pretty', 'false'],
    },
];

for (const check of checks) {
    console.log(`\n==> ${check.name}`);
    const result = spawnSync(check.command, check.args, {
        cwd: rootDir,
        stdio: 'inherit',
        shell: false,
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

console.log(
    '\nRound 20 static audit passed. This includes Gate 3 sample inventory; runtime evidence is tracked in the Round 20 Gate documents.',
);

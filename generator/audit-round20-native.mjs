import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const androidDir = path.join(rootDir, 'android');
const isWindows = process.platform === 'win32';
const gradleCommand = isWindows ? '.\\gradlew.bat' : './gradlew';

const baseArgs = [
    ':react-native-nitro-player:compileReleaseKotlin',
    '--no-daemon',
    '--console=plain',
    '--rerun-tasks',
];

const checks = [
    {
        name: 'Nitro default FFmpeg + WMA Kotlin compile',
        args: baseArgs,
    },
    {
        name: 'Nitro WMA disabled rollback Kotlin compile',
        args: [
            ':react-native-nitro-player:compileReleaseKotlin',
            '-PmusicfreeEnableWmaExtractor=false',
            '--no-daemon',
            '--console=plain',
            '--rerun-tasks',
        ],
    },
];

for (const check of checks) {
    console.log(`\n==> ${check.name}`);
    const command = isWindows ? 'cmd.exe' : gradleCommand;
    const args = isWindows
        ? ['/d', '/s', '/c', gradleCommand, ...check.args]
        : check.args;
    const result = spawnSync(command, args, {
        cwd: androidDir,
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
    '\nRound 20 native audit passed. Runtime evidence is tracked in the Round 20 Gate documents.',
);

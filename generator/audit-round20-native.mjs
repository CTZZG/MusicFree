import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
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
        name: 'MusicFree app Kotlin compile',
        args: [
            ':app:compileReleaseKotlin',
            '--no-daemon',
            '--console=plain',
            '--rerun-tasks',
        ],
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

const lifecycleSources = {
    service: readFileSync(
        path.join(
            androidDir,
            'app/src/main/java/fun/upup/musicfree/mpvplayer/MpvPlaybackService.kt',
        ),
        'utf8',
    ),
    bridge: readFileSync(
        path.join(
            androidDir,
            'app/src/main/java/fun/upup/musicfree/mpvplayer/MpvServiceBridge.kt',
        ),
        'utf8',
    ),
    module: readFileSync(
        path.join(
            androidDir,
            'app/src/main/java/fun/upup/musicfree/mpvplayer/MpvPlayerModule.kt',
        ),
        'utf8',
    ),
    lyricUtil: readFileSync(
        path.join(
            androidDir,
            'app/src/main/java/fun/upup/musicfree/lyricUtil/LyricUtilModule.kt',
        ),
        'utf8',
    ),
};

const lifecycleAssertions = [
    [
        'null service restart is non-sticky',
        lifecycleSources.service,
        /intent\s*==\s*null[\s\S]{0,120}START_NOT_STICKY/,
    ],
    [
        'service handler callbacks are cleared',
        lifecycleSources.service,
        /mainHandler\.removeCallbacksAndMessages\(null\)/,
    ],
    [
        'service bridge is volatile',
        lifecycleSources.bridge,
        /@Volatile\s+var service:/,
    ],
    [
        'command bridge is volatile',
        lifecycleSources.bridge,
        /@Volatile\s+var onCommand:/,
    ],
    [
        'queued commands re-check initialization',
        lifecycleSources.module,
        /mainHandler\.post\s*\{\s*if\s*\(!isInitialized\.get\(\)\)/,
    ],
    [
        'native lyric updates follow the active backend',
        lifecycleSources.lyricUtil,
        /routesToMpv[\s\S]+routesToNitro[\s\S]+setActivePlayerBackend/,
    ],
];

for (const [name, source, pattern] of lifecycleAssertions) {
    if (!pattern.test(source)) {
        console.error(`MPV lifecycle assertion failed: ${name}`);
        process.exit(1);
    }
}

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

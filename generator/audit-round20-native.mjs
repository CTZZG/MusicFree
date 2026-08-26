import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const androidDir = path.join(rootDir, 'android');
const isWindows = process.platform === 'win32';
const gradleCommand = isWindows ? '.\\gradlew.bat' : './gradlew';

const checks = [
    {
        name: 'MusicFree app Kotlin compile',
        args: [
            ':app:compileReleaseKotlin',
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
    storageUri: readFileSync(
        path.join(
            androidDir,
            'app/src/main/java/fun/upup/musicfree/storageuri/StorageUriModule.kt',
        ),
        'utf8',
    ),
    mp3Util: readFileSync(
        path.join(
            androidDir,
            'app/src/main/java/fun/upup/musicfree/mp3Util/Mp3UtilModule.kt',
        ),
        'utf8',
    ),
    androidAuto: readFileSync(
        path.join(
            androidDir,
            'app/src/main/java/fun/upup/musicfree/mpvplayer/MpvAndroidAutoConnectionDetector.kt',
        ),
        'utf8',
    ),
    cancelablePromise: readFileSync(
        path.join(
            androidDir,
            'app/src/main/java/fun/upup/musicfree/bridge/CancelablePromise.kt',
        ),
        'utf8',
    ),
};

const lifecycleAssertions = [
    [
        // 窗口放宽到 800：null-intent 分支里现在还要清理幽灵通知（进程被杀后
        // 系统重建服务，但 bridge 已随旧进程消失，通知按钮全是 no-op）。
        // 注意这类断言只是「字符串出现在附近」，并不校验控制流——它能发现
        // 整段代码被删掉，但挡不住逻辑写错。
        'null service restart is non-sticky',
        lifecycleSources.service,
        /intent\s*==\s*null[\s\S]{0,800}START_NOT_STICKY/,
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
        'queued MPV promises are tracked and cancelled on invalidation',
        lifecycleSources.module,
        /PendingMainTask[\s\S]+postPromise[\s\S]+override fun invalidate\(\)[\s\S]+pendingMainTasks\.toList\(\)[\s\S]+activePromises\.toList\(\)/,
    ],
    [
        'MPV invalidation releases native observers and callbacks',
        lifecycleSources.module,
        /override fun invalidate\(\)[\s\S]+releaseMpvResources[\s\S]+super\.invalidate\(\)/,
    ],
    [
        'StorageUri queued promises are rejected during teardown',
        lifecycleSources.storageUri,
        /PendingIoTask[\s\S]+activePromises\.toList\(\)\.forEach[\s\S]+shutdownNow\(\)\.forEach[\s\S]+rejectCancelled\(\)/,
    ],
    [
        'StorageUri cancellation uses a stable error code',
        lifecycleSources.storageUri,
        /E_STORAGE_URI_CANCELLED/,
    ],
    [
        'metadata queued promises are rejected during teardown',
        lifecycleSources.mp3Util,
        /PendingMetadataTask[\s\S]+activePromises\.toList\(\)\.forEach[\s\S]+shutdownNow\(\)\.forEach[\s\S]+rejectCancelled\(\)/,
    ],
    [
        'metadata cancellation uses a stable error code',
        lifecycleSources.mp3Util,
        /E_METADATA_CANCELLED/,
    ],
    [
        'Android Auto late queries are cancelled',
        lifecycleSources.androidAuto,
        /fun unregister\(\)[\s\S]{0,320}cancelOperation\(QUERY_TOKEN\)/,
    ],
    [
        'Android Auto callbacks are detached',
        lifecycleSources.androidAuto,
        /fun unregister\(\)[\s\S]{0,320}onConnectionChanged = null/,
    ],
    [
        // Nitro 后端已移除，这里只需确认桌面歌词仍走 mpv 路由。
        'native lyric updates route to mpv',
        lifecycleSources.lyricUtil,
        /routesToMpv/,
    ],
    [
        'native promises settle atomically and expose conditional resolution',
        lifecycleSources.cancelablePromise,
        /AtomicBoolean\(false\)[\s\S]+compareAndSet\(false, true\)[\s\S]+resolveIfPending/,
    ],
    [
        'detached descriptors close when teardown wins the resolve race',
        lifecycleSources.storageUri,
        /resolveIfPending\(detachedFd\)[\s\S]{0,180}ParcelFileDescriptor\.adoptFd\(detachedFd\)\.close\(\)/,
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

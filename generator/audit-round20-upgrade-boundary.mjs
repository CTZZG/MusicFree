import {execFileSync} from 'node:child_process';
import {
    existsSync,
    readdirSync,
    readFileSync,
    statSync,
} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const expectedNitroVersion = '1.5.0';
const nitroRoot = path.join(rootDir, 'node_modules', 'react-native-nitro-player');
const patchPath = path.join(
    rootDir,
    'patches',
    `react-native-nitro-player+${expectedNitroVersion}.patch`,
);
const musicfreePackagePath = 'node_modules/react-native-nitro-player/android/src/main/java/com/margelo/nitro/nitroplayer/musicfree';
const musicfreeDir = path.join(rootDir, musicfreePackagePath);
const patchGeneratorPath = path.join(rootDir, 'generator', 'patch-media3-ffmpeg-aar.mjs');
const wrapperSourcePath = path.join(
    rootDir,
    'generator',
    'native',
    'media3_ffmpeg_jni_wrapper_legacy.cc',
);
const patchedAarPath = path.join(
    rootDir,
    'android',
    'app',
    'libs',
    'musicfree-media3-ffmpeg-decoder-1.9.0+1.aar',
);

const allowedSeamFiles = [
    'node_modules/react-native-nitro-player/android/build.gradle',
    'node_modules/react-native-nitro-player/android/consumer-rules.pro',
    'node_modules/react-native-nitro-player/android/src/main/java/com/margelo/nitro/nitroplayer/core/TrackPlayerCore.kt',
    'node_modules/react-native-nitro-player/android/src/main/java/com/margelo/nitro/nitroplayer/core/TrackPlayerListener.kt',
    'node_modules/react-native-nitro-player/android/src/main/java/com/margelo/nitro/nitroplayer/core/TrackPlayerQueueBuild.kt',
    'node_modules/react-native-nitro-player/android/src/main/java/com/margelo/nitro/nitroplayer/media/ExoPlayerBuilder.kt',
    'node_modules/react-native-nitro-player/android/src/main/java/com/margelo/nitro/nitroplayer/media/PlaybackService.kt',
    'node_modules/react-native-nitro-player/ios/core/TrackPlayerCore.swift',
    'node_modules/react-native-nitro-player/ios/core/TrackPlayerQueueBuild.swift',
    'node_modules/react-native-nitro-player/ios/core/TrackPlayerRedirectResolver.swift',
];

const requiredMusicfreeFiles = [
    'AsfWmaExtractor.kt',
    'AsfWmaHeaderParser.kt',
    'AsfWmaPacketParser.kt',
    'AsfWmaPayloadAssembler.kt',
    'DsfExtractor.kt',
    'MusicFreeAudioExtractorRegistry.kt',
    'MusicFreeAudioFormatRegistry.kt',
    'MusicFreeExtractorsFactory.kt',
    'MusicFreePlayerExtensions.kt',
];

// JVM/instrumentation tests for the patched Nitro transport. These live
// outside musicfreePackagePath, and because allowedPatchFiles is enforced in
// both directions they must stay in the patch: a regeneration that drops them
// (as happened before 2026-07-26) now fails this audit instead of silently
// shipping an untested transport.
// The Nitro-side controlled DataSource and its JVM/instrumentation tests were
// reverted on 2026-07-26, so there are no longer extra test files in the patch.
const requiredMusicfreeTestFiles = [];

const allowedPatchFiles = new Set([
    ...allowedSeamFiles,
    ...requiredMusicfreeTestFiles,
    ...requiredMusicfreeFiles.map(fileName => `${musicfreePackagePath}/${fileName}`),
]);

const errors = [];

function relative(filePath) {
    return path.relative(rootDir, filePath);
}

function read(filePath) {
    try {
        return readFileSync(filePath, 'utf8');
    } catch (error) {
        errors.push(`Missing or unreadable file: ${relative(filePath)} (${error.message})`);
        return '';
    }
}

function requireFile(filePath, label) {
    if (!existsSync(filePath)) {
        errors.push(`Missing ${label}: ${relative(filePath)}`);
        return;
    }
    if (statSync(filePath).size <= 0) {
        errors.push(`Empty ${label}: ${relative(filePath)}`);
    }
}

function requireTokens(label, source, tokens) {
    for (const token of tokens) {
        if (!source.includes(token)) {
            errors.push(`${label} missing token: ${token}`);
        }
    }
}

function extractPatchFiles(patchSource) {
    return patchSource
        .split(/\r?\n/)
        .filter(line => line.startsWith('diff --git '))
        .map(line => {
            const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
            return match?.[2] ?? '';
        })
        .filter(Boolean)
        .sort();
}

function checkPatchPackageState() {
    try {
        const patchPackageEntry = path.join(
            rootDir,
            'node_modules',
            'patch-package',
            'index.js',
        );
        execFileSync(
            process.execPath,
            [patchPackageEntry, '--check'],
            {
                cwd: rootDir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
    } catch (error) {
        errors.push(
            `patch-package state check failed for ${relative(patchPath)}\n${error.stderr ?? error.message}`,
        );
    }
}

requireFile(patchPath, 'Nitro patch-package patch');
requireFile(patchGeneratorPath, 'Media3 FFmpeg AAR generator');
requireFile(wrapperSourcePath, 'Media3 FFmpeg JNI wrapper source');
requireFile(patchedAarPath, 'patched Media3 FFmpeg AAR');

const nitroPackageJson = JSON.parse(read(path.join(nitroRoot, 'package.json')) || '{}');
if (nitroPackageJson.version !== expectedNitroVersion) {
    errors.push(
        `Unexpected react-native-nitro-player version: ${nitroPackageJson.version ?? 'unknown'} (expected ${expectedNitroVersion}). Update the Round 20 upgrade audit before upgrading.`,
    );
}

const patchSource = read(patchPath);
const patchedFiles = extractPatchFiles(patchSource);
for (const filePath of patchedFiles) {
    if (!allowedPatchFiles.has(filePath)) {
        errors.push(`Unexpected file in Nitro patch boundary: ${filePath}`);
    }
    if (
        filePath.includes('/lib/') ||
        filePath.includes('/nitrogen/') ||
        filePath.includes('/generated/') ||
        filePath.includes('/android/build/')
    ) {
        errors.push(`Nitro patch must not touch generated/build output: ${filePath}`);
    }
}
for (const filePath of allowedPatchFiles) {
    if (!patchedFiles.includes(filePath)) {
        errors.push(`Expected file missing from Nitro patch boundary: ${filePath}`);
    }
}

const actualMusicfreeFiles = existsSync(musicfreeDir)
    ? readdirSync(musicfreeDir)
        .filter(fileName => fileName.endsWith('.kt'))
        .sort()
    : [];
for (const fileName of requiredMusicfreeFiles) {
    const fullPath = path.join(musicfreeDir, fileName);
    requireFile(fullPath, `MusicFree native extension ${fileName}`);
    const source = read(fullPath);
    requireTokens(fileName, source, ['package com.margelo.nitro.nitroplayer.musicfree']);
}
for (const fileName of actualMusicfreeFiles) {
    if (!requiredMusicfreeFiles.includes(fileName)) {
        errors.push(`Untracked MusicFree native extension file: ${musicfreePackagePath}/${fileName}`);
    }
}

const buildGradle = read(path.join(nitroRoot, 'android', 'build.gradle'));
requireTokens('Nitro android/build.gradle seam', buildGradle, [
    'MUSICFREE_ENABLE_WMA_EXTRACTOR',
    'musicfreeEnableWmaExtractor',
    'musicfreeEnableExperimentalWmaExtractor',
]);
const consumerRules = read(path.join(nitroRoot, 'android', 'consumer-rules.pro'));
requireTokens('Nitro Android consumer rules', consumerRules, [
    'NitroCastOptionsProvider',
    'com.google.android.gms.cast.framework.OptionsProvider',
]);

const appBuildGradle = read(path.join(rootDir, 'android', 'app', 'build.gradle'));
requireTokens('App android/build.gradle FFmpeg seam', appBuildGradle, [
    'musicfreeEnableNitroFfmpeg',
    'musicfree-media3-ffmpeg-decoder-${media3Version}+1.aar',
    'Nitro Media3 FFmpeg is the only packaged audio extension path',
]);

const exoPlayerBuilder = read(path.join(
    nitroRoot,
    'android',
    'src',
    'main',
    'java',
    'com',
    'margelo',
    'nitro',
    'nitroplayer',
    'media',
    'ExoPlayerBuilder.kt',
));
requireTokens('ExoPlayerBuilder seam', exoPlayerBuilder, [
    'MusicFreePlayerExtensions.createRenderersFactory(context)',
    'MusicFreePlayerExtensions.createMediaSourceFactory(context)',
]);

const playerExtensions = read(path.join(
    nitroRoot,
    'android',
    'src',
    'main',
    'java',
    'com',
    'margelo',
    'nitro',
    'nitroplayer',
    'musicfree',
    'MusicFreePlayerExtensions.kt',
));
// The controlled DataSource was reverted on 2026-07-26; Nitro uses Media3's own
// HTTP stack again. The header-resolving wrapper is functional (per-track
// headers) and must stay.
requireTokens('MusicFreePlayerExtensions transport seam', playerExtensions, [
    'ResolvingDataSource.Factory(DefaultHttpDataSource.Factory())',
    'DefaultDataSource.Factory(context, resolvingDataSourceFactory)',
]);
if (playerExtensions.includes('MusicFreePublicHttpDataSourceFactory')) {
    errors.push(
        'MusicFreePlayerExtensions must not reinstate the reverted MusicFree data source',
    );
}


const queueBuild = read(path.join(
    nitroRoot,
    'android',
    'src',
    'main',
    'java',
    'com',
    'margelo',
    'nitro',
    'nitroplayer',
    'core',
    'TrackPlayerQueueBuild.kt',
));
requireTokens('TrackPlayerQueueBuild seam', queueBuild, [
    'MusicFreePlayerExtensions.registerTrackRequest(track, effectiveUrl)',
]);

const listener = read(path.join(
    nitroRoot,
    'android',
    'src',
    'main',
    'java',
    'com',
    'margelo',
    'nitro',
    'nitroplayer',
    'core',
    'TrackPlayerListener.kt',
));
requireTokens('TrackPlayerListener seam', listener, [
    'NitroPlayerLogger.log("TrackPlayerError")',
    'PlaybackException.getErrorCodeName(error.errorCode)',
]);

const iosCore = read(path.join(nitroRoot, 'ios', 'core', 'TrackPlayerCore.swift'));
requireTokens('iOS Nitro core media loader seam', iosCore, [
    'MusicFree-controlled AVAsset resource loader',
    'internal let redirectResolver = TrackPlayerRedirectResolver()',
]);

const iosQueueBuild = read(path.join(
    nitroRoot,
    'ios',
    'core',
    'TrackPlayerQueueBuild.swift',
));
requireTokens('iOS Nitro queue media loader seam', iosQueueBuild, [
    'TrackPlayerRedirectResolver.wrap(url)',
    'redirectResolver.registerHeaders(httpHeaders(for: track), for: wrappedURL)',
    'asset.resourceLoader.setDelegate(redirectResolver, queue: redirectResolver.queue)',
]);

const iosResourceLoader = read(path.join(
    nitroRoot,
    'ios',
    'core',
    'TrackPlayerRedirectResolver.swift',
));
requireTokens('iOS Nitro controlled media loader', iosResourceLoader, [
    'AVAssetResourceLoaderDelegate, URLSessionDataDelegate',
    'nitromedia+',
    'validatePublicMediaURL',
    'Only HTTPS remote media URLs are allowed',
    'resolvePublicHost',
    'getaddrinfo',
    'isBlockedIpv4',
    'isBlockedIpv6',
    'Only same-origin HTTPS redirects are allowed',
    'request.httpMethod = dataRequest == nil ? "HEAD" : "GET"',
    'request.setValue(rangeHeader, forHTTPHeaderField: "Range")',
    'request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")',
    'blockedRequestHeaders',
    'task.cancel()',
]);

const patchGenerator = read(patchGeneratorPath);
requireTokens('Media3 FFmpeg AAR generator', patchGenerator, [
    'media3_ffmpeg_jni_wrapper_legacy.cc',
    'libffmJNIb.so',
    'ffmpegRef',
    'verifyNativeLibraries',
    'musicfree-media3-ffmpeg-decoder',
    'FfmpegAudioDecoder.java',
    'audio/x-ms-wmapro',
]);

const wrapperSource = read(wrapperSourcePath);
requireTokens('Media3 FFmpeg JNI wrapper source', wrapperSource, [
    'libffmJNIb.so',
    'FfmpegAudioDecoder',
    'AV_CODEC_ID_DSD_LSBF_PLANAR',
    'swr_convert',
]);

checkPatchPackageState();

if (errors.length > 0) {
    console.error('Round 20 upgrade boundary audit failed:');
    for (const error of errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

console.log('Round 20 upgrade boundary audit passed.');
console.log(`Patched Nitro files: ${patchedFiles.length}`);
console.log(`MusicFree native extension files: ${requiredMusicfreeFiles.length}`);

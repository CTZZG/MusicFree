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
const nitroRoot = path.join(rootDir, 'node_modules', 'react-native-nitro-player');
const patchPath = path.join(rootDir, 'patches', 'react-native-nitro-player+1.4.1.patch');
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
    'node_modules/react-native-nitro-player/android/src/main/java/com/margelo/nitro/nitroplayer/core/TrackPlayerListener.kt',
    'node_modules/react-native-nitro-player/android/src/main/java/com/margelo/nitro/nitroplayer/core/TrackPlayerQueueBuild.kt',
    'node_modules/react-native-nitro-player/android/src/main/java/com/margelo/nitro/nitroplayer/media/ExoPlayerBuilder.kt',
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

const allowedPatchFiles = new Set([
    ...allowedSeamFiles,
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

function checkPatchReverseApplies() {
    try {
        execFileSync(
            'git',
            ['apply', '--reverse', '--check', relative(patchPath)],
            {
                cwd: rootDir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
    } catch (error) {
        errors.push(
            `Patch no longer reverse-applies cleanly: ${relative(patchPath)}\n${error.stderr ?? error.message}`,
        );
    }
}

requireFile(patchPath, 'Nitro patch-package patch');
requireFile(patchGeneratorPath, 'Media3 FFmpeg AAR generator');
requireFile(wrapperSourcePath, 'Media3 FFmpeg JNI wrapper source');
requireFile(patchedAarPath, 'patched Media3 FFmpeg AAR');

const nitroPackageJson = JSON.parse(read(path.join(nitroRoot, 'package.json')) || '{}');
if (nitroPackageJson.version !== '1.4.1') {
    errors.push(
        `Unexpected react-native-nitro-player version: ${nitroPackageJson.version ?? 'unknown'} (expected 1.4.1). Update the Round 20 upgrade audit before upgrading.`,
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
    'musicfreeEnableNitroFfmpeg',
    'musicfree-media3-ffmpeg-decoder-$media3_version+1.aar',
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

checkPatchReverseApplies();

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

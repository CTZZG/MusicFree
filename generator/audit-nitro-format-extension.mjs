import {execFileSync} from 'node:child_process';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const nitroAndroidDir = path.join(
    rootDir,
    'node_modules',
    'react-native-nitro-player',
    'android',
);
const musicfreeDir = path.join(
    nitroAndroidDir,
    'src',
    'main',
    'java',
    'com',
    'margelo',
    'nitro',
    'nitroplayer',
    'musicfree',
);
const patchPath = path.join(
    rootDir,
    'patches',
    'react-native-nitro-player+1.4.1.patch',
);
const media3FfmpegAarPath = path.join(
    rootDir,
    'android',
    'app',
    'libs',
    'musicfree-media3-ffmpeg-decoder-1.9.0+1.aar',
);
const androidAbis = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];
const baseFfmpegLibraryName = 'libffmJNIb.so';

const files = {
    appGradle: path.join(rootDir, 'android', 'app', 'build.gradle'),
    nitroGradle: path.join(nitroAndroidDir, 'build.gradle'),
    exoPlayerBuilder: path.join(
        nitroAndroidDir,
        'src',
        'main',
        'java',
        'com',
        'margelo',
        'nitro',
        'nitroplayer',
        'media',
        'ExoPlayerBuilder.kt',
    ),
    audioExtractorRegistry: path.join(
        musicfreeDir,
        'MusicFreeAudioExtractorRegistry.kt',
    ),
    audioFormatRegistry: path.join(
        musicfreeDir,
        'MusicFreeAudioFormatRegistry.kt',
    ),
    dsfExtractor: path.join(musicfreeDir, 'DsfExtractor.kt'),
    extractorsFactory: path.join(musicfreeDir, 'MusicFreeExtractorsFactory.kt'),
    playerExtensions: path.join(musicfreeDir, 'MusicFreePlayerExtensions.kt'),
    asfWmaHeaderParser: path.join(musicfreeDir, 'AsfWmaHeaderParser.kt'),
    asfWmaPacketParser: path.join(musicfreeDir, 'AsfWmaPacketParser.kt'),
    asfWmaPayloadAssembler: path.join(
        musicfreeDir,
        'AsfWmaPayloadAssembler.kt',
    ),
    asfWmaExtractor: path.join(musicfreeDir, 'AsfWmaExtractor.kt'),
    commonConst: path.join(rootDir, 'src', 'constants', 'commonConst.ts'),
    mediaFormatDiagnostics: path.join(
        rootDir,
        'src',
        'utils',
        'mediaFormatDiagnostics.ts',
    ),
    ffmpegJniWrapper: path.join(
        rootDir,
        'generator',
        'native',
        'media3_ffmpeg_jni_wrapper.cc',
    ),
    ffmpegJniWrapperLegacy: path.join(
        rootDir,
        'generator',
        'native',
        'media3_ffmpeg_jni_wrapper_legacy.cc',
    ),
    patch: patchPath,
};

const errors = [];
const warnings = [];

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
    const size = statSync(filePath).size;
    if (size <= 0) {
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

function forbidTokens(label, source, tokens) {
    for (const token of tokens) {
        if (source.includes(token)) {
            errors.push(`${label} should not include token: ${token}`);
        }
    }
}

function checkPatchAppliesReverse() {
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

function checkPatchedAarCodecMapping() {
    if (!existsSync(media3FfmpegAarPath)) {
        return;
    }

    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'musicfree-audit-media3-ffmpeg-aar-'));
    try {
        execFileSync('jar', ['xf', media3FfmpegAarPath, 'classes.jar'], {
            cwd: tmpDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const classesJar = path.join(tmpDir, 'classes.jar');
        const javapOutput = execFileSync(
            'javap',
            [
                '-classpath',
                classesJar,
                '-c',
                '-p',
                'androidx.media3.decoder.ffmpeg.FfmpegLibrary',
            ],
            {
                cwd: rootDir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
        for (const token of [
            'audio/x-ms-wma',
            'wmav2',
            'audio/x-dsf',
            'dsd_lsbf_planar',
        ]) {
            if (!javapOutput.includes(token)) {
                errors.push(`Patched AAR FfmpegLibrary missing token: ${token}`);
            }
        }
        const decoderJavapOutput = execFileSync(
            'javap',
            [
                '-classpath',
                classesJar,
                '-c',
                '-p',
                'androidx.media3.decoder.ffmpeg.FfmpegAudioDecoder',
            ],
            {
                cwd: rootDir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
        for (const token of [
            'audio/x-ms-wma',
            'audio/x-ms-wma-v1',
            'audio/x-ms-wmapro',
            'getExtraData',
        ]) {
            if (!decoderJavapOutput.includes(token)) {
                errors.push(`Patched AAR FfmpegAudioDecoder missing token: ${token}`);
            }
        }
        const createInputBufferBody =
            decoderJavapOutput.match(
                /protected androidx\.media3\.decoder\.DecoderInputBuffer createInputBuffer\(\);[\s\S]*?(?=\n  (?:protected|public|private|static)|\n})/,
            )?.[0] ?? '';
        if (!createInputBufferBody.includes('iconst_2')) {
            errors.push(
                'Patched AAR FfmpegAudioDecoder createInputBuffer does not use direct input buffers',
            );
        }
    } catch (error) {
        errors.push(
            `Could not inspect patched Media3 FFmpeg AAR codec mapping: ${
                error.stderr ?? error.message
            }`,
        );
    } finally {
        rmSync(tmpDir, {recursive: true, force: true});
    }
}

function findNdkDir() {
    for (const envName of ['ANDROID_NDK_HOME', 'ANDROID_NDK_PATH']) {
        const candidate = process.env[envName];
        if (candidate && existsSync(candidate)) {
            return candidate;
        }
    }

    const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
    if (!androidHome) {
        return null;
    }
    const ndkRoot = path.join(androidHome, 'ndk');
    const preferred = path.join(ndkRoot, '26.1.10909125');
    if (existsSync(preferred)) {
        return preferred;
    }
    if (!existsSync(ndkRoot)) {
        return null;
    }
    const versions = readdirSync(ndkRoot)
        .filter(name => existsSync(path.join(ndkRoot, name, 'toolchains', 'llvm')))
        .sort();
    const latest = versions.at(-1);
    return latest ? path.join(ndkRoot, latest) : null;
}

function hostTag() {
    if (process.platform === 'win32') {
        return 'windows-x86_64';
    }
    if (process.platform === 'linux') {
        return 'linux-x86_64';
    }
    if (process.platform === 'darwin') {
        return process.arch === 'arm64' ? 'darwin-aarch64' : 'darwin-x86_64';
    }
    return null;
}

function llvmTool(ndkDir, tool) {
    const host = hostTag();
    if (!host) {
        return null;
    }
    const suffix = process.platform === 'win32' ? '.exe' : '';
    const toolPath = path.join(
        ndkDir,
        'toolchains',
        'llvm',
        'prebuilt',
        host,
        'bin',
        `${tool}${suffix}`,
    );
    return existsSync(toolPath) ? toolPath : null;
}

function checkPatchedAarNativeWrapper() {
    if (!existsSync(media3FfmpegAarPath)) {
        return;
    }

    const ndkDir = findNdkDir();
    const readelf = ndkDir ? llvmTool(ndkDir, 'llvm-readelf') : null;
    const nm = ndkDir ? llvmTool(ndkDir, 'llvm-nm') : null;
    if (!readelf || !nm) {
        errors.push('Could not inspect patched Media3 FFmpeg native wrapper: Android NDK llvm tools missing');
        return;
    }

    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'musicfree-audit-media3-ffmpeg-native-'));
    try {
        execFileSync('jar', ['xf', media3FfmpegAarPath, 'jni'], {
            cwd: tmpDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        for (const abi of androidAbis) {
            const wrapperPath = path.join(tmpDir, 'jni', abi, 'libffmpegJNI.so');
            const basePath = path.join(tmpDir, 'jni', abi, baseFfmpegLibraryName);
            if (!existsSync(wrapperPath)) {
                errors.push(`Patched AAR missing ${abi} FFmpeg JNI wrapper`);
                continue;
            }
            if (!existsSync(basePath)) {
                errors.push(`Patched AAR missing ${abi} FFmpeg JNI base library`);
                continue;
            }

            const wrapperDynamic = execFileSync(readelf, ['-d', wrapperPath], {
                cwd: rootDir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            if (!wrapperDynamic.includes('Library soname: [libffmpegJNI.so]')) {
                errors.push(`FFmpeg JNI wrapper SONAME check failed for ${abi}`);
            }
            for (const forbidden of [baseFfmpegLibraryName, 'libc++_shared.so']) {
                if (wrapperDynamic.includes(forbidden)) {
                    errors.push(`FFmpeg JNI wrapper for ${abi} unexpectedly depends on ${forbidden}`);
                }
            }

            const baseDynamic = execFileSync(readelf, ['-d', basePath], {
                cwd: rootDir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            if (!baseDynamic.includes(`Library soname: [${baseFfmpegLibraryName}]`)) {
                errors.push(`FFmpeg JNI base SONAME check failed for ${abi}`);
            }

            const symbols = execFileSync(nm, ['-D', '--defined-only', wrapperPath], {
                cwd: rootDir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            for (const token of [
                'JNI_OnLoad',
                'FfmpegAudioDecoder_ffmpegInitialize',
                'FfmpegAudioDecoder_ffmpegDecode',
                'FfmpegLibrary_ffmpegHasDecoder',
            ]) {
                if (!symbols.includes(token)) {
                    errors.push(`FFmpeg JNI wrapper for ${abi} missing symbol: ${token}`);
                }
            }
        }
    } catch (error) {
        errors.push(
            `Could not inspect patched Media3 FFmpeg native wrapper: ${
                error.stderr ?? error.message
            }`,
        );
    } finally {
        rmSync(tmpDir, {recursive: true, force: true});
    }
}

requireFile(media3FfmpegAarPath, 'patched Media3 FFmpeg AAR');
if (existsSync(media3FfmpegAarPath)) {
    const size = statSync(media3FfmpegAarPath).size;
    if (size < 1024 * 1024) {
        errors.push(
            `Patched Media3 FFmpeg AAR is suspiciously small: ${size} bytes`,
        );
    }
}
checkPatchedAarNativeWrapper();

for (const [label, filePath] of Object.entries(files)) {
    requireFile(filePath, label);
}

const appGradle = read(files.appGradle);
const nitroGradle = read(files.nitroGradle);
const exoPlayerBuilder = read(files.exoPlayerBuilder);
const audioExtractorRegistry = read(files.audioExtractorRegistry);
const audioFormatRegistry = read(files.audioFormatRegistry);
const dsfExtractor = read(files.dsfExtractor);
const extractorsFactory = read(files.extractorsFactory);
const playerExtensions = read(files.playerExtensions);
const asfWmaHeaderParser = read(files.asfWmaHeaderParser);
const asfWmaPacketParser = read(files.asfWmaPacketParser);
const asfWmaPayloadAssembler = read(files.asfWmaPayloadAssembler);
const asfWmaExtractor = read(files.asfWmaExtractor);
const commonConst = read(files.commonConst);
const mediaFormatDiagnostics = read(files.mediaFormatDiagnostics);
const ffmpegJniWrapper = read(files.ffmpegJniWrapper);
const ffmpegJniWrapperLegacy = read(files.ffmpegJniWrapperLegacy);
const patch = read(files.patch);

requireTokens('android/app/build.gradle', appGradle, [
    'Nitro Media3 FFmpeg is the only packaged audio extension path',
]);
requireTokens('react-native-nitro-player/android/build.gradle', nitroGradle, [
    'musicfreeEnableNitroFfmpeg',
    'enableMusicFreeNitroFfmpeg',
    'musicfree-media3-ffmpeg-decoder-$media3_version+1.aar',
    'MUSICFREE_ENABLE_WMA_EXTRACTOR',
    'musicfreeEnableWmaExtractor',
    'musicfreeEnableExperimentalWmaExtractor',
]);
requireTokens('ExoPlayerBuilder.kt', exoPlayerBuilder, [
    'MusicFreePlayerExtensions',
    'createRenderersFactory',
    'createMediaSourceFactory',
]);
requireTokens('MusicFreePlayerExtensions.kt', playerExtensions, [
    'MusicFreeAudioFormatRegistry.registerCustomMimeTypes',
    'DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER',
    'MusicFreeExtractorsFactory',
    'MusicFreeAudioExtractorRegistry.factories',
]);
requireTokens('MusicFreeExtractorsFactory.kt', extractorsFactory, [
    'ExtractorsFactory',
    'extensionFactories',
    'createExtractors',
]);
requireTokens('MusicFreeAudioExtractorRegistry.kt', audioExtractorRegistry, [
    '::DsfExtractor',
    'BuildConfig.MUSICFREE_ENABLE_WMA_EXTRACTOR',
    '::AsfWmaExtractor',
]);
requireTokens('MusicFreeAudioFormatRegistry.kt', audioFormatRegistry, [
    'MIME_DSF',
    'MIME_WMA',
    'MIME_WMA_PRO',
    'CODEC_DSF',
    'CODEC_WMAV2',
    'CODEC_WMAPRO',
]);
requireTokens('DsfExtractor.kt', dsfExtractor, [
    'internal class DsfExtractor',
    'DSD ',
    'fmt ',
    'data',
    'extractorOutput?.seekMap',
    'MusicFreeAudioFormatRegistry.MIME_DSF',
]);
requireTokens('AsfWmaHeaderParser.kt', asfWmaHeaderParser, [
    'internal object AsfWmaHeaderParser',
    'MIME_WMA_V1',
    'MIME_WMA_V2',
    'MIME_WMA_PRO',
    'MIME_WMA_LOSSLESS',
    'MIME_WMA_VOICE',
    'val waveFormatExData',
    'codecSpecificData = waveFormatExData',
]);
requireTokens('AsfWmaPacketParser.kt', asfWmaPacketParser, [
    'internal object AsfWmaPacketParser',
    'payloads',
    'mediaObjectNumber',
]);
requireTokens('AsfWmaPayloadAssembler.kt', asfWmaPayloadAssembler, [
    'internal class AsfWmaPayloadAssembler',
    'samples',
    'subPayloadSize',
]);
requireTokens('AsfWmaExtractor.kt', asfWmaExtractor, [
    'internal class AsfWmaExtractor',
    'AsfWmaHeaderParser',
    'AsfWmaPacketParser',
    'AsfWmaPayloadAssembler',
    'extractorOutput?.seekMap',
    'MusicFreeAudioFormatRegistry.MIME_WMA',
    '.setSampleMimeType(parsedAudioStream.sampleMimeType)',
    '.setCodecs(parsedAudioStream.codecName)',
    '.setInitializationData(listOf(parsedAudioStream.codecSpecificData))',
]);
for (const [label, source] of [
    ['media3_ffmpeg_jni_wrapper.cc', ffmpegJniWrapper],
    ['media3_ffmpeg_jni_wrapper_legacy.cc', ffmpegJniWrapperLegacy],
]) {
    requireTokens(label, source, [
        'kWaveFormatExMinSize',
        'isWaveFormatExCodec',
        'applyWaveFormatEx',
        'block_align',
        'bits_per_coded_sample',
        'codecExtraSize',
    ]);
}
requireTokens('supportLocalMediaType', commonConst, [
    '".m4a"',
    '".wma"',
    '".asf"',
    '".dsf"',
]);
forbidTokens('supportLocalMediaType', commonConst, ['".dff"']);
requireTokens('mediaFormatDiagnostics.ts', mediaFormatDiagnostics, [
    'experimentalFormatDiagnostics',
    'm4a:',
    'wma:',
    'asf:',
    'dsf:',
    'dff:',
    'ALAC',
    'WMA',
    'DSF',
    'DFF/DSDIFF',
]);
requireTokens('patch-package patch', patch, [
    'MUSICFREE_ENABLE_WMA_EXTRACTOR',
    'musicfreeEnableNitroFfmpeg',
    'MusicFreePlayerExtensions.kt',
    'MusicFreeExtractorsFactory.kt',
    'MusicFreeAudioExtractorRegistry.kt',
    'MusicFreeAudioFormatRegistry.kt',
    'DsfExtractor.kt',
    'AsfWmaHeaderParser.kt',
    'AsfWmaPacketParser.kt',
    'AsfWmaPayloadAssembler.kt',
    'AsfWmaExtractor.kt',
]);
checkPatchAppliesReverse();
checkPatchedAarCodecMapping();

console.log('Nitro format extension audit');
console.log(`Patched AAR: ${relative(media3FfmpegAarPath)}`);
console.log(`MusicFree native dir: ${relative(musicfreeDir)}`);
console.log(`Patch: ${relative(patchPath)}`);

if (warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of warnings) {
        console.log(`- ${warning}`);
    }
}

if (errors.length > 0) {
    console.error('\nAudit failed:');
    for (const error of errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

console.log('\nAudit passed. Runtime playback evidence is tracked in the Round 20 Gate documents.');

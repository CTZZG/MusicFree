import {execFileSync} from 'node:child_process';
import {
    cpSync,
    createWriteStream,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const media3Version = '1.9.0';
const jellyfinVersion = `${media3Version}+1`;
const ffmpegRef = 'e98a6be89b5554621ece683c824c475cc44b2195';
const baseLibraryName = 'libffmJNIb.so';
const originalLibraryName = 'libffmpegJNI.so';
const minSdk = 23;
const androidAbis = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];

const outputAar = path.join(
    rootDir,
    'android',
    'app',
    'libs',
    `musicfree-media3-ffmpeg-decoder-${jellyfinVersion}.aar`,
);

const homeDir = os.homedir();
const gradleCache = path.join(homeDir, '.gradle', 'caches', 'modules-2', 'files-2.1');
const wrapperSource = path.join(
    __dirname,
    'native',
    'media3_ffmpeg_jni_wrapper_legacy.cc',
);
const legacyNativeBaseAar = path.join(
    rootDir,
    'android',
    'app',
    'libs',
    'exoplayer-ffmpeg-extension-v2.19.1.aar',
);

function downloadFile(url, destination) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, response => {
            if (
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location
            ) {
                response.resume();
                downloadFile(response.headers.location, destination)
                    .then(resolve)
                    .catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(new Error(`Download failed ${response.statusCode}: ${url}`));
                return;
            }
            const file = createWriteStream(destination);
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
            file.on('error', reject);
        });
        request.on('error', reject);
    });
}

function findFirstFile(startDir, fileName) {
    if (!existsSync(startDir)) {
        return null;
    }

    const stack = [startDir];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const entry of readdirSync(current, {withFileTypes: true})) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile() && entry.name === fileName) {
                return fullPath;
            }
        }
    }
    return null;
}

function run(command, args, options = {}) {
    execFileSync(command, args, {
        cwd: rootDir,
        stdio: 'pipe',
        encoding: 'utf8',
        ...options,
    });
}

function powershellLiteral(value) {
    return `'${value.replace(/'/g, "''")}'`;
}

async function ensureFfmpegSourceDir() {
    const fromEnv = process.env.MUSICFREE_FFMPEG_SOURCE_DIR;
    if (fromEnv && existsSync(path.join(fromEnv, 'libavcodec', 'avcodec.h'))) {
        return fromEnv;
    }

    const cacheDir = path.join(os.tmpdir(), `musicfree-ffmpeg-headers-${ffmpegRef}`);
    const findExtractedSourceDir = () => {
        if (!existsSync(cacheDir)) {
            return null;
        }
        for (const entry of readdirSync(cacheDir, {withFileTypes: true})) {
            if (!entry.isDirectory()) {
                continue;
            }
            const candidate = path.join(cacheDir, entry.name);
            if (existsSync(path.join(candidate, 'libavcodec', 'avcodec.h'))) {
                return candidate;
            }
        }
        return null;
    };

    const cachedSourceDir = findExtractedSourceDir();
    if (cachedSourceDir) {
        return cachedSourceDir;
    }

    rmSync(cacheDir, {recursive: true, force: true});
    mkdirSync(cacheDir, {recursive: true});
    const zipPath = path.join(cacheDir, `ffmpeg-${ffmpegRef}.zip`);
    await downloadFile(
        `https://codeload.github.com/FFmpeg/FFmpeg/zip/${ffmpegRef}`,
        zipPath,
    );

    try {
        run('tar', ['-xf', zipPath, '-C', cacheDir]);
    } catch {
        if (process.platform !== 'win32') {
            run('unzip', ['-q', zipPath, '-d', cacheDir]);
        } else {
            run('powershell', [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                `Expand-Archive -LiteralPath ${powershellLiteral(zipPath)} -DestinationPath ${powershellLiteral(cacheDir)} -Force`,
            ]);
        }
    }

    const extractedSourceDir = findExtractedSourceDir();
    if (!extractedSourceDir) {
        throw new Error(`Could not prepare FFmpeg ${ffmpegRef} headers under ${cacheDir}`);
    }
    return extractedSourceDir;
}

function writeGeneratedAvconfig(includeDir) {
    const libavutilDir = path.join(includeDir, 'libavutil');
    mkdirSync(libavutilDir, {recursive: true});
    writeFileSync(
        path.join(libavutilDir, 'avconfig.h'),
        [
            '#ifndef AVUTIL_AVCONFIG_H',
            '#define AVUTIL_AVCONFIG_H',
            '#define AV_HAVE_BIGENDIAN 0',
            '#define AV_HAVE_FAST_UNALIGNED 1',
            '#endif',
            '',
        ].join('\n'),
        'ascii',
    );
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
        throw new Error('ANDROID_HOME or ANDROID_SDK_ROOT is required to compile FFmpeg JNI wrapper.');
    }

    const ndkRoot = path.join(androidHome, 'ndk');
    const preferred = path.join(ndkRoot, '26.1.10909125');
    if (existsSync(preferred)) {
        return preferred;
    }

    const versions = readdirSync(ndkRoot)
        .filter(name => existsSync(path.join(ndkRoot, name, 'toolchains', 'llvm')))
        .sort();
    const latest = versions.at(-1);
    if (!latest) {
        throw new Error(`No Android NDK found under ${ndkRoot}`);
    }
    return path.join(ndkRoot, latest);
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
    throw new Error(`Unsupported host platform: ${process.platform}`);
}

function compilerForAbi(ndkDir, abi) {
    const binDir = path.join(ndkDir, 'toolchains', 'llvm', 'prebuilt', hostTag(), 'bin');
    const triples = {
        'armeabi-v7a': `armv7a-linux-androideabi${minSdk}`,
        'arm64-v8a': `aarch64-linux-android${minSdk}`,
        x86: `i686-linux-android${minSdk}`,
        x86_64: `x86_64-linux-android${minSdk}`,
    };
    const compiler =
        process.platform === 'win32'
            ? path.join(binDir, 'clang++.exe')
            : path.join(binDir, `${triples[abi]}-clang++`);
    if (!existsSync(compiler)) {
        throw new Error(`Missing Android compiler for ${abi}: ${compiler}`);
    }
    return {
        command: compiler,
        prefixArgs: process.platform === 'win32' ? [`--target=${triples[abi]}`] : [],
    };
}

function llvmTool(ndkDir, tool) {
    const executableSuffix = process.platform === 'win32' ? '.exe' : '';
    const toolPath = path.join(
        ndkDir,
        'toolchains',
        'llvm',
        'prebuilt',
        hostTag(),
        'bin',
        `${tool}${executableSuffix}`,
    );
    if (!existsSync(toolPath)) {
        throw new Error(`Missing LLVM tool: ${toolPath}`);
    }
    return toolPath;
}

function patchLibrarySoname(libraryPath) {
    const oldName = Buffer.from(`${originalLibraryName}\0`, 'ascii');
    const newName = Buffer.from(`${baseLibraryName}\0`, 'ascii');
    if (newName.length > oldName.length) {
        throw new Error(`${baseLibraryName} must not be longer than ${originalLibraryName}`);
    }

    const bytes = readFileSync(libraryPath);
    const index = bytes.indexOf(oldName);
    if (index === -1) {
        throw new Error(`Could not find ${originalLibraryName} SONAME in ${libraryPath}`);
    }
    if (bytes.indexOf(oldName, index + 1) !== -1) {
        throw new Error(`Found multiple ${originalLibraryName} strings in ${libraryPath}`);
    }

    bytes.fill(0, index, index + oldName.length);
    newName.copy(bytes, index);
    writeFileSync(libraryPath, bytes);
}

function compileWrapper({abi, outputPath, ffmpegSourceDir, includeDir, ndkDir}) {
    const compiler = compilerForAbi(ndkDir, abi);
    run(compiler.command, [
        ...compiler.prefixArgs,
        '-shared',
        '-fPIC',
        '-std=c++17',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Wno-unused-parameter',
        '-nostdlib++',
        '-I',
        includeDir,
        '-I',
        ffmpegSourceDir,
        '-Wl,-soname,libffmpegJNI.so',
        '-Wl,-z,max-page-size=16384',
        '-o',
        outputPath,
        wrapperSource,
        '-llog',
        '-ldl',
        '-landroid',
    ]);
}

function verifyNativeLibraries({abi, wrapperPath, basePath, ndkDir}) {
    const readelf = llvmTool(ndkDir, 'llvm-readelf');
    const nm = llvmTool(ndkDir, 'llvm-nm');
    const wrapperDynamic = execFileSync(readelf, ['-d', wrapperPath], {
        cwd: rootDir,
        encoding: 'utf8',
    });
    if (!wrapperDynamic.includes('Library soname: [libffmpegJNI.so]')) {
        throw new Error(`Wrapper SONAME check failed for ${abi}`);
    }
    for (const forbidden of [baseLibraryName, 'libc++_shared.so']) {
        if (wrapperDynamic.includes(forbidden)) {
            throw new Error(`Wrapper for ${abi} unexpectedly has DT_NEEDED ${forbidden}`);
        }
    }

    const baseDynamic = execFileSync(readelf, ['-d', basePath], {
        cwd: rootDir,
        encoding: 'utf8',
    });
    if (!baseDynamic.includes(`Library soname: [${baseLibraryName}]`)) {
        throw new Error(`Base SONAME check failed for ${abi}`);
    }

    const symbols = execFileSync(nm, ['-D', '--defined-only', wrapperPath], {
        cwd: rootDir,
        encoding: 'utf8',
    });
    for (const token of [
        'JNI_OnLoad',
        'FfmpegAudioDecoder_ffmpegInitialize',
        'FfmpegAudioDecoder_ffmpegDecode',
        'FfmpegLibrary_ffmpegHasDecoder',
    ]) {
        if (!symbols.includes(token)) {
            throw new Error(`Wrapper for ${abi} missing symbol: ${token}`);
        }
    }
}

function patchNativeLibraries({aarDir, ffmpegSourceDir, includeDir, ndkDir}) {
    const jniDir = path.join(aarDir, 'jni');
    for (const abi of androidAbis) {
        const abiDir = path.join(jniDir, abi);
        const originalPath = path.join(abiDir, originalLibraryName);
        if (!existsSync(originalPath)) {
            continue;
        }

        const basePath = path.join(abiDir, baseLibraryName);
        rmSync(basePath, {force: true});
        renameSync(originalPath, basePath);
        patchLibrarySoname(basePath);

        compileWrapper({
            abi,
            outputPath: originalPath,
            ffmpegSourceDir,
            includeDir,
            ndkDir,
        });
        verifyNativeLibraries({
            abi,
            wrapperPath: originalPath,
            basePath,
            ndkDir,
        });
    }
}

const baseAar = findFirstFile(
    path.join(
        gradleCache,
        'org.jellyfin.media3',
        'media3-ffmpeg-decoder',
        jellyfinVersion,
    ),
    `media3-ffmpeg-decoder-${jellyfinVersion}.aar`,
);
const media3CommonAar = findFirstFile(
    path.join(gradleCache, 'androidx.media3', 'media3-common', media3Version),
    `media3-common-${media3Version}.aar`,
);
const media3DecoderAar = findFirstFile(
    path.join(gradleCache, 'androidx.media3', 'media3-decoder', media3Version),
    `media3-decoder-${media3Version}.aar`,
);
const guavaJar = findFirstFile(
    path.join(gradleCache, 'com.google.guava', 'guava'),
    'guava-33.3.1-android.jar',
);

if (!baseAar) {
    throw new Error(`Missing Jellyfin Media3 FFmpeg AAR ${jellyfinVersion} in Gradle cache.`);
}
if (!media3CommonAar) {
    throw new Error(`Missing Media3 common AAR ${media3Version} in Gradle cache.`);
}
if (!media3DecoderAar) {
    throw new Error(`Missing Media3 decoder AAR ${media3Version} in Gradle cache.`);
}
if (!guavaJar) {
    throw new Error('Missing Guava 33.3.1 Android jar in Gradle cache.');
}
if (!existsSync(legacyNativeBaseAar)) {
    throw new Error(`Missing legacy FFmpeg native base AAR: ${legacyNativeBaseAar}`);
}

const workDir = path.join(os.tmpdir(), 'musicfree-patch-media3-ffmpeg-aar');
rmSync(workDir, {recursive: true, force: true});
mkdirSync(workDir, {recursive: true});

const aarDir = path.join(workDir, 'aar');
const commonDir = path.join(workDir, 'media3-common');
const decoderDir = path.join(workDir, 'media3-decoder');
const legacyNativeDir = path.join(workDir, 'legacy-native-base');
const sourceDir = path.join(workDir, 'src');
const classDir = path.join(workDir, 'classes');
const generatedIncludeDir = path.join(workDir, 'generated-include');
mkdirSync(aarDir, {recursive: true});
mkdirSync(commonDir, {recursive: true});
mkdirSync(decoderDir, {recursive: true});
mkdirSync(legacyNativeDir, {recursive: true});
mkdirSync(sourceDir, {recursive: true});
mkdirSync(classDir, {recursive: true});
mkdirSync(generatedIncludeDir, {recursive: true});

const ffmpegSourceDir = await ensureFfmpegSourceDir();
const ndkDir = findNdkDir();
writeGeneratedAvconfig(generatedIncludeDir);

run('jar', ['xf', baseAar], {cwd: aarDir});
run('jar', ['xf', media3CommonAar], {cwd: commonDir});
run('jar', ['xf', media3DecoderAar], {cwd: decoderDir});
run('jar', ['xf', legacyNativeBaseAar], {cwd: legacyNativeDir});

rmSync(path.join(aarDir, 'jni'), {recursive: true, force: true});
cpSync(path.join(legacyNativeDir, 'jni'), path.join(aarDir, 'jni'), {
    recursive: true,
});

const sourcePackageDir = path.join(
    sourceDir,
    'androidx',
    'media3',
    'decoder',
    'ffmpeg',
);
mkdirSync(sourcePackageDir, {recursive: true});

const ffmpegLibrarySource = `package androidx.media3.decoder.ffmpeg;

import androidx.media3.common.MediaLibraryInfo;
import androidx.media3.common.util.LibraryLoader;
import androidx.media3.common.util.Log;

public final class FfmpegLibrary {
  private static final String TAG = "FfmpegLibrary";
  private static final LibraryLoader LOADER =
      new LibraryLoader("ffmpegJNI") {
        @Override
        protected void loadLibrary(String name) {
          System.loadLibrary(name);
        }
      };

  private static String version;
  private static int inputBufferPaddingSize = -1;

  private FfmpegLibrary() {}

  public static void setLibraries(String... libraries) {
    LOADER.setLibraries(libraries);
  }

  public static boolean isAvailable() {
    return LOADER.isAvailable();
  }

  public static String getVersion() {
    if (!isAvailable()) {
      return null;
    }
    if (version == null) {
      version = ffmpegGetVersion();
    }
    return version;
  }

  public static int getInputBufferPaddingSize() {
    if (!isAvailable()) {
      return -1;
    }
    if (inputBufferPaddingSize == -1) {
      inputBufferPaddingSize = ffmpegGetInputBufferPaddingSize();
    }
    return inputBufferPaddingSize;
  }

  public static boolean supportsFormat(String sampleMimeType) {
    if (!isAvailable()) {
      return false;
    }
    String codecName = getCodecName(sampleMimeType);
    if (codecName == null) {
      return false;
    }
    if (!ffmpegHasDecoder(codecName)) {
      Log.w(TAG, "No " + codecName + " decoder available. Check the FFmpeg build configuration.");
      return false;
    }
    return true;
  }

  static String getCodecName(String sampleMimeType) {
    switch (sampleMimeType) {
      case "audio/mp4a-latm":
        return "aac";
      case "audio/mpeg":
      case "audio/mpeg-L1":
      case "audio/mpeg-L2":
        return "mp3";
      case "audio/ac3":
        return "ac3";
      case "audio/eac3":
      case "audio/eac3-joc":
        return "eac3";
      case "audio/true-hd":
        return "truehd";
      case "audio/vnd.dts":
      case "audio/vnd.dts.hd":
        return "dca";
      case "audio/vorbis":
        return "vorbis";
      case "audio/opus":
        return "opus";
      case "audio/3gpp":
        return "amrnb";
      case "audio/amr-wb":
        return "amrwb";
      case "audio/flac":
        return "flac";
      case "audio/alac":
        return "alac";
      case "audio/g711-mlaw":
        return "pcm_mulaw";
      case "audio/g711-alaw":
        return "pcm_alaw";
      case "video/avc":
        return "h264";
      case "video/hevc":
        return "hevc";
      case "audio/x-ms-wma":
      case "audio/x-ms-wma-v2":
        return "wmav2";
      case "audio/x-ms-wma-v1":
        return "wmav1";
      case "audio/x-ms-wmapro":
        return "wmapro";
      case "audio/x-ms-wmalossless":
        return "wmalossless";
      case "audio/x-ms-wmavoice":
        return "wmavoice";
      case "audio/x-dsf":
      case "audio/dsf":
      case "audio/x-dsd":
        return "dsd_lsbf_planar";
      default:
        return null;
    }
  }

  private static native String ffmpegGetVersion();

  private static native int ffmpegGetInputBufferPaddingSize();

  private static native boolean ffmpegHasDecoder(String codecName);

  static {
    MediaLibraryInfo.registerModule("media3.decoder.ffmpeg");
  }
}
`;

// TODO: replace this local class copy with a source-patched Media3/Jellyfin fork.
// MusicFree needs WMA codec-specific data from ASF WAVEFORMATEX to reach FFmpeg.
// The upstream Media3 class only forwards initializationData for AAC/Opus/ALAC/
// Vorbis/FLAC, so WMA would otherwise initialize with null extradata.
const ffmpegAudioDecoderSource = `package androidx.media3.decoder.ffmpeg;

import androidx.media3.common.Format;
import androidx.media3.common.util.ParsableByteArray;
import androidx.media3.decoder.DecoderInputBuffer;
import androidx.media3.decoder.DecoderException;
import androidx.media3.decoder.SimpleDecoder;
import androidx.media3.decoder.SimpleDecoderOutputBuffer;
import com.google.common.base.Preconditions;
import java.nio.ByteBuffer;
import java.util.List;

final class FfmpegAudioDecoder
    extends SimpleDecoder<DecoderInputBuffer, SimpleDecoderOutputBuffer, FfmpegDecoderException> {
  private static final int INITIAL_OUTPUT_BUFFER_SIZE_16BIT = 65535;
  private static final int INITIAL_OUTPUT_BUFFER_SIZE_32BIT = 131070;
  private static final int AUDIO_DECODER_ERROR_INVALID_DATA = -1;
  private static final int AUDIO_DECODER_ERROR_OTHER = -2;
  private static final byte[] flacStreamMarker = new byte[] {'f', 'L', 'a', 'C'};

  private final String codecName;
  private final byte[] extraData;
  private final int encoding;
  private int outputBufferSize;
  private long nativeContext;
  private boolean hasOutputFormat;
  private volatile int channelCount;
  private volatile int sampleRate;

  public FfmpegAudioDecoder(
      Format format,
      int numInputBuffers,
      int numOutputBuffers,
      int initialInputBufferSize,
      boolean outputFloat)
      throws FfmpegDecoderException {
    super(
        new DecoderInputBuffer[numInputBuffers],
        new SimpleDecoderOutputBuffer[numOutputBuffers]);
    if (!FfmpegLibrary.isAvailable()) {
      throw new FfmpegDecoderException("Failed to load decoder native libraries.");
    }
    Preconditions.checkNotNull(format.sampleMimeType);
    codecName = Preconditions.checkNotNull(FfmpegLibrary.getCodecName(format.sampleMimeType));
    extraData = getExtraData(format.sampleMimeType, format.initializationData);
    encoding = outputFloat ? 4 : 2;
    outputBufferSize =
        outputFloat ? INITIAL_OUTPUT_BUFFER_SIZE_32BIT : INITIAL_OUTPUT_BUFFER_SIZE_16BIT;
    nativeContext =
        ffmpegInitialize(
            codecName, extraData, outputFloat, format.sampleRate, format.channelCount);
    if (nativeContext == 0) {
      throw new FfmpegDecoderException("Initialization failed.");
    }
    setInitialInputBufferSize(initialInputBufferSize);
  }

  public String getName() {
    return "ffmpeg" + FfmpegLibrary.getVersion() + "-" + codecName;
  }

  @Override
  protected DecoderInputBuffer createInputBuffer() {
    return new DecoderInputBuffer(DecoderInputBuffer.BUFFER_REPLACEMENT_MODE_DIRECT,
        FfmpegLibrary.getInputBufferPaddingSize());
  }

  @Override
  protected SimpleDecoderOutputBuffer createOutputBuffer() {
    return new SimpleDecoderOutputBuffer(this::releaseOutputBuffer);
  }

  @Override
  protected FfmpegDecoderException createUnexpectedDecodeException(Throwable error) {
    return new FfmpegDecoderException("Unexpected decode error", error);
  }

  @Override
  protected FfmpegDecoderException decode(
      DecoderInputBuffer inputBuffer, SimpleDecoderOutputBuffer outputBuffer, boolean reset) {
    if (reset) {
      nativeContext = ffmpegReset(nativeContext, extraData);
      if (nativeContext == 0) {
        return new FfmpegDecoderException("Error resetting (see logcat).");
      }
    }

    ByteBuffer inputData = inputBuffer.data;
    int inputSize = inputData.limit();
    ByteBuffer outputData = outputBuffer.init(inputBuffer.timeUs, outputBufferSize);
    int result =
        ffmpegDecode(nativeContext, inputData, inputSize, outputBuffer, outputData, outputBufferSize);
    if (result == AUDIO_DECODER_ERROR_OTHER) {
      return new FfmpegDecoderException("Error decoding (see logcat).");
    }
    if (result == AUDIO_DECODER_ERROR_INVALID_DATA || result == 0) {
      outputBuffer.shouldBeSkipped = true;
      return null;
    }

    if (!hasOutputFormat) {
      channelCount = ffmpegGetChannelCount(nativeContext);
      sampleRate = ffmpegGetSampleRate(nativeContext);
      if (sampleRate == 0 && "alac".equals(codecName)) {
        Preconditions.checkNotNull(extraData);
        ParsableByteArray extraDataParser = new ParsableByteArray(extraData);
        extraDataParser.setPosition(extraData.length - 4);
        sampleRate = extraDataParser.readUnsignedIntToInt();
      }
      hasOutputFormat = true;
    }

    outputData = Preconditions.checkNotNull(outputBuffer.data);
    outputData.position(0);
    outputData.limit(result);
    return null;
  }

  private ByteBuffer growOutputBuffer(SimpleDecoderOutputBuffer outputBuffer, int newSize) {
    outputBufferSize = newSize;
    return outputBuffer.grow(newSize);
  }

  @Override
  public void release() {
    super.release();
    ffmpegRelease(nativeContext);
    nativeContext = 0;
  }

  public int getChannelCount() {
    return channelCount;
  }

  public int getSampleRate() {
    return sampleRate;
  }

  public int getEncoding() {
    return encoding;
  }

  private static byte[] getExtraData(String sampleMimeType, List<byte[]> initializationData) {
    switch (sampleMimeType) {
      case "audio/mp4a-latm":
      case "audio/opus":
      case "audio/x-ms-wma":
      case "audio/x-ms-wma-v1":
      case "audio/x-ms-wma-v2":
      case "audio/x-ms-wmapro":
      case "audio/x-ms-wmalossless":
      case "audio/x-ms-wmavoice":
        return initializationData.isEmpty() ? null : initializationData.get(0);
      case "audio/alac":
        return getAlacExtraData(initializationData);
      case "audio/vorbis":
        return getVorbisExtraData(initializationData);
      case "audio/flac":
        return getFlacExtraData(initializationData);
      default:
        return null;
    }
  }

  private static byte[] getAlacExtraData(List<byte[]> initializationData) {
    byte[] alacSpecificConfig = initializationData.get(0);
    int size = 12 + alacSpecificConfig.length;
    ByteBuffer extraData = ByteBuffer.allocate(size);
    extraData.putInt(size);
    extraData.putInt(0x616c6163);
    extraData.putInt(0);
    extraData.put(alacSpecificConfig, 0, alacSpecificConfig.length);
    return extraData.array();
  }

  private static byte[] getVorbisExtraData(List<byte[]> initializationData) {
    byte[] header0 = initializationData.get(0);
    byte[] header1 = initializationData.get(1);
    byte[] extraData = new byte[header0.length + header1.length + 6];
    extraData[0] = (byte) (header0.length >> 8);
    extraData[1] = (byte) (header0.length & 0xff);
    System.arraycopy(header0, 0, extraData, 2, header0.length);
    extraData[header0.length + 2] = 0;
    extraData[header0.length + 3] = 0;
    extraData[header0.length + 4] = (byte) (header1.length >> 8);
    extraData[header0.length + 5] = (byte) (header1.length & 0xff);
    System.arraycopy(header1, 0, extraData, header0.length + 6, header1.length);
    return extraData;
  }

  private static byte[] getFlacExtraData(List<byte[]> initializationData) {
    for (int i = 0; i < initializationData.size(); i++) {
      byte[] streamInfo = extractFlacStreamInfo(initializationData.get(i));
      if (streamInfo != null) {
        return streamInfo;
      }
    }
    return null;
  }

  private static byte[] extractFlacStreamInfo(byte[] data) {
    int offset = arrayStartsWith(data, flacStreamMarker) ? flacStreamMarker.length : 0;
    if (data.length - offset == 34) {
      byte[] streamInfo = new byte[34];
      System.arraycopy(data, offset, streamInfo, 0, 34);
      return streamInfo;
    }
    if (data.length >= offset + 4) {
      int type = data[offset] & 0x7f;
      int length =
          ((data[offset + 1] & 0xff) << 16)
              | ((data[offset + 2] & 0xff) << 8)
              | (data[offset + 3] & 0xff);
      if (type == 0 && length == 34 && data.length >= offset + 4 + 34) {
        byte[] streamInfo = new byte[34];
        System.arraycopy(data, offset + 4, streamInfo, 0, 34);
        return streamInfo;
      }
    }
    return null;
  }

  private static boolean arrayStartsWith(byte[] data, byte[] prefix) {
    if (data.length < prefix.length) {
      return false;
    }
    for (int i = 0; i < prefix.length; i++) {
      if (data[i] != prefix[i]) {
        return false;
      }
    }
    return true;
  }

  private native long ffmpegInitialize(
      String codecName, byte[] extraData, boolean outputFloat, int rawSampleRate, int rawChannelCount);

  private native int ffmpegDecode(
      long nativeContext,
      ByteBuffer inputData,
      int inputSize,
      SimpleDecoderOutputBuffer outputBuffer,
      ByteBuffer outputData,
      int outputSize);

  private native int ffmpegGetChannelCount(long nativeContext);

  private native int ffmpegGetSampleRate(long nativeContext);

  private native long ffmpegReset(long nativeContext, byte[] extraData);

  private native void ffmpegRelease(long nativeContext);
}
`;

const sourceFile = path.join(sourcePackageDir, 'FfmpegLibrary.java');
writeFileSync(sourceFile, ffmpegLibrarySource, 'utf8');
const decoderSourceFile = path.join(sourcePackageDir, 'FfmpegAudioDecoder.java');
writeFileSync(decoderSourceFile, ffmpegAudioDecoderSource, 'utf8');
const classesJar = path.join(aarDir, 'classes.jar');

run('javac', [
    '-cp',
    [
        classesJar,
        path.join(commonDir, 'classes.jar'),
        path.join(decoderDir, 'classes.jar'),
        guavaJar,
    ].join(path.delimiter),
    '-d',
    classDir,
    sourceFile,
    decoderSourceFile,
]);

run('jar', [
    'uf',
    classesJar,
    '-C',
    classDir,
    'androidx/media3/decoder/ffmpeg/FfmpegLibrary.class',
    '-C',
    classDir,
    'androidx/media3/decoder/ffmpeg/FfmpegLibrary$1.class',
    '-C',
    classDir,
    'androidx/media3/decoder/ffmpeg/FfmpegAudioDecoder.class',
]);

const javapOutput = execFileSync(
    'javap',
    ['-classpath', classesJar, '-c', '-p', 'androidx.media3.decoder.ffmpeg.FfmpegLibrary'],
    {cwd: rootDir, encoding: 'utf8'},
);
for (const token of ['audio/x-ms-wma', 'wmav2', 'audio/x-dsf', 'dsd_lsbf_planar']) {
    if (!javapOutput.includes(token)) {
        throw new Error(`Patched FfmpegLibrary is missing token: ${token}`);
    }
}
const decoderJavapOutput = execFileSync(
    'javap',
    ['-classpath', classesJar, '-c', '-p', 'androidx.media3.decoder.ffmpeg.FfmpegAudioDecoder'],
    {cwd: rootDir, encoding: 'utf8'},
);
for (const token of ['audio/x-ms-wma', 'audio/x-ms-wmapro', 'getExtraData']) {
    if (!decoderJavapOutput.includes(token)) {
        throw new Error(`Patched FfmpegAudioDecoder is missing token: ${token}`);
    }
}

patchNativeLibraries({
    aarDir,
    ffmpegSourceDir,
    includeDir: generatedIncludeDir,
    ndkDir,
});

const patchedAar = path.join(workDir, path.basename(outputAar));
run('jar', ['cf', patchedAar, '-C', aarDir, '.']);
cpSync(patchedAar, outputAar);

const size = statSync(outputAar).size;
console.log(`Patched ${path.relative(rootDir, outputAar)} (${size} bytes)`);
console.log(`Media3 class base AAR: ${baseAar}`);
console.log(`Legacy FFmpeg native base AAR: ${legacyNativeBaseAar}`);
console.log(`FFmpeg headers: ${ffmpegSourceDir}`);
console.log(`Android NDK: ${ndkDir}`);
console.log(`DSF MIME now maps to dsd_lsbf_planar, with legacy JNI wrapper loading ${baseLibraryName}.`);

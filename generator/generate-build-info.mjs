import {execSync} from 'node:child_process';
import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const androidBuildGradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
const outputPath = path.join(
    rootDir,
    'src',
    'constants',
    'buildInfo.generated.ts',
);
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

function run(command, fallback = '') {
    try {
        return execSync(command, {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return fallback;
    }
}

function getSigningState() {
    const explicitStatus = process.env.SIGNING_STATUS?.trim();
    if (explicitStatus) {
        return explicitStatus;
    }

    const hasCiSigning = Boolean(
        process.env.RELEASE_KEYSTORE_BASE64 ||
            process.env.ANDROID_RELEASE_KEYSTORE_BASE64,
    );
    const keystorePath = path.join(rootDir, 'android', 'keystore.properties');
    const hasLocalSigning =
        existsSync(keystorePath) &&
        [
            'RELEASE_STORE_FILE',
            'RELEASE_STORE_PASSWORD',
            'RELEASE_KEY_ALIAS',
            'RELEASE_KEY_PASSWORD',
        ].every(key =>
            new RegExp(`^\\s*${key}\\s*=\\s*\\S+`, 'm').test(
                readFileSync(keystorePath, 'utf8'),
            ),
        );
    return hasCiSigning || hasLocalSigning ? 'configured' : 'unsigned';
}

function getAndroidVersionCode() {
    const gradle = readFileSync(androidBuildGradlePath, 'utf8');
    const match = gradle.match(/\bappVersionCode\s*=\s*(\d+)/);
    return match?.[1] ?? 'unknown';
}

// 播放内核 libmpv 的版本写在 libmpv.so 里（形如 "mpv v0.41.0"）。读不到
// （AAR 不在、格式异常）时记 unknown，不影响构建。直接用 Node 读取 ZIP 条目，
// 不依赖外部 unzip CLI，也无需经过 shell，工程路径含空格、$ 或引号都能工作。
const MPV_LIBRARY_ENTRY = 'jni/arm64-v8a/libmpv.so';
const MAX_AAR_FILE_BYTES = 256 * 1024 * 1024;
const MAX_MPV_ENTRY_BYTES = 128 * 1024 * 1024;
const ZIP64_SENTINEL_U32 = 0xffffffff;

function readZipEntry(zip, entryName) {
    if (zip.length < 22 || zip.length > MAX_AAR_FILE_BYTES) {
        return null;
    }
    let eocdOffset = -1;
    const minOffset = Math.max(0, zip.length - 65557);
    for (let i = zip.length - 22; i >= minOffset; i -= 1) {
        if (zip.readUInt32LE(i) === 0x06054b50 && zip.readUInt16LE(i + 20) === zip.length - i - 22) {
            eocdOffset = i;
            break;
        }
    }
    if (eocdOffset < 0) {
        return null;
    }

    const totalEntries = zip.readUInt16LE(eocdOffset + 10);
    const cdSize = zip.readUInt32LE(eocdOffset + 12);
    const cdOffset = zip.readUInt32LE(eocdOffset + 16);
    if (
        totalEntries === 0xffff ||
        cdSize === ZIP64_SENTINEL_U32 ||
        cdOffset === ZIP64_SENTINEL_U32 ||
        cdOffset > eocdOffset ||
        cdSize > eocdOffset - cdOffset
    ) {
        return null;
    }

    const cdEnd = cdOffset + cdSize;
    let offset = cdOffset;
    for (let i = 0; i < totalEntries && offset + 46 <= cdEnd; i += 1) {
        if (zip.readUInt32LE(offset) !== 0x02014b50) {
            return null;
        }
        const flags = zip.readUInt16LE(offset + 8);
        const method = zip.readUInt16LE(offset + 10);
        const expectedCrc = zip.readUInt32LE(offset + 16);
        const compressedSize = zip.readUInt32LE(offset + 20);
        const uncompressedSize = zip.readUInt32LE(offset + 24);
        const nameLen = zip.readUInt16LE(offset + 28);
        const extraLen = zip.readUInt16LE(offset + 30);
        const commentLen = zip.readUInt16LE(offset + 32);
        const localHeaderOffset = zip.readUInt32LE(offset + 42);
        const nextOffset = offset + 46 + nameLen + extraLen + commentLen;
        if (nextOffset > cdEnd) {
            return null;
        }
        const name = zip.toString('utf8', offset + 46, offset + 46 + nameLen);
        offset = nextOffset;

        if (name !== entryName) {
            continue;
        }
        if (
            (flags & 0x01) !== 0 ||
            compressedSize === ZIP64_SENTINEL_U32 ||
            uncompressedSize === ZIP64_SENTINEL_U32 ||
            localHeaderOffset === ZIP64_SENTINEL_U32 ||
            uncompressedSize > MAX_MPV_ENTRY_BYTES ||
            compressedSize > cdOffset
        ) {
            return null;
        }
        if (localHeaderOffset + 30 > cdOffset || zip.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
            return null;
        }
        const localNameLen = zip.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = zip.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataStart > cdOffset || dataEnd > cdOffset) {
            return null;
        }
        const compressedSlice = zip.subarray(dataStart, dataEnd);
        let library = null;
        if (method === 0) {
            if (compressedSize !== uncompressedSize) {
                return null;
            }
            library = compressedSlice;
        } else if (method === 8) {
            library = zlib.inflateRawSync(compressedSlice, {maxOutputLength: MAX_MPV_ENTRY_BYTES});
        } else {
            return null;
        }
        if (library.length !== uncompressedSize || (zlib.crc32(library) >>> 0) !== expectedCrc) {
            return null;
        }
        return library;
    }
    return null;
}

function getMpvVersion() {
    const aarPath = path.join(rootDir, 'android', 'app', 'libs', 'libmpv-release.aar');
    if (!existsSync(aarPath)) {
        return 'unknown';
    }
    try {
        const stats = statSync(aarPath);
        if (!stats.isFile() || stats.size > MAX_AAR_FILE_BYTES) {
            return 'unknown';
        }
        const library = readZipEntry(readFileSync(aarPath), MPV_LIBRARY_ENTRY);
        return library ? (library.toString('latin1').match(/mpv v\d+\.\d+(?:\.\d+)?/)?.[0] ?? 'unknown') : 'unknown';
    } catch {
        return 'unknown';
    }
}

// 打包的源码提交。Beta 构建指定 build_ref 时它和触发工作流的提交（GITHUB_SHA）不同
const gitSha =
    process.env.BUILD_SOURCE_SHA ||
    process.env.GITHUB_SHA ||
    run('git rev-parse HEAD', 'unknown');
const shortSha = process.env.SHORT_SHA || gitSha.slice(0, 7);
const gitRef =
    process.env.BUILD_REF_NAME ||
    process.env.GITHUB_REF_NAME ||
    process.env.GITHUB_REF ||
    run('git branch --show-current', 'unknown');
const gitRefType = process.env.BUILD_REF_TYPE || process.env.GITHUB_REF_TYPE || 'branch';
const buildRunUrl =
    process.env.BUILD_RUN_URL ||
    (process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : '');

const dependencies = packageJson.dependencies ?? {};
const buildInfo = {
    appVersion: process.env.APP_VERSION || packageJson.version,
    packageVersion: process.env.PACKAGE_VERSION || packageJson.version,
    versionCode: getAndroidVersionCode(),
    gitSha,
    shortSha,
    gitRef,
    gitRefType,
    buildRunUrl,
    buildDate: process.env.BUILD_DATE || new Date().toISOString(),
    signing: getSigningState(),
    node: process.version,
    react: dependencies.react ?? 'unknown',
    reactNative: dependencies['react-native'] ?? 'unknown',
    expo: dependencies.expo ?? 'unknown',
    player: getMpvVersion(),
};

const fileContent = `// This file is generated by generator/generate-build-info.mjs.
// It is committed with a baseline value so TypeScript can compile before the first generated build.

export const buildInfo = ${JSON.stringify(buildInfo, null, 4)} as const;

export type BuildInfo = typeof buildInfo;
`;

writeFileSync(outputPath, fileContent, 'utf8');
console.log(`Generated ${path.relative(rootDir, outputPath)}`);

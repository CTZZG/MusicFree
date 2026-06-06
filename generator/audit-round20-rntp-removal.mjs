import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const errors = [];

const forbiddenPatterns = [
    {
        label: 'react-native-track-player dependency/import',
        pattern: /react-native-track-player/,
    },
    {
        label: 'RNTP playback service registration',
        pattern: /registerPlaybackService/,
    },
    {
        label: 'TrackPlayerV4 adapter',
        pattern: /TrackPlayerV4|trackPlayerV4Adapter|trackPlayerV4/,
    },
    {
        label: 'developer player backend selector',
        pattern: /debug\.playerBackend/,
    },
];

const filesToScan = [
    'index.js',
    'package.json',
    'package-lock.json',
    'android/app/build.gradle',
];

const directoriesToScan = [
    'src',
    'patches',
];

function relative(filePath) {
    return path.relative(rootDir, filePath);
}

function scanFile(filePath) {
    if (!existsSync(filePath)) {
        return;
    }
    const source = readFileSync(filePath, 'utf8');
    const lines = source.split(/\r?\n/);
    for (const {label, pattern} of forbiddenPatterns) {
        for (const [index, line] of lines.entries()) {
            if (pattern.test(line)) {
                errors.push(`${label} at ${relative(filePath)}:${index + 1}: ${line.trim()}`);
            }
        }
    }
}

function scanDirectory(dirPath) {
    if (!existsSync(dirPath)) {
        return;
    }
    for (const entry of readdirSync(dirPath)) {
        const fullPath = path.join(dirPath, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
            scanDirectory(fullPath);
            continue;
        }
        if (
            /\.(?:js|jsx|ts|tsx|json|gradle|kt|java|patch)$/i.test(entry) ||
            entry.includes('react-native-track-player')
        ) {
            scanFile(fullPath);
        }
    }
}

for (const filePath of filesToScan) {
    scanFile(path.join(rootDir, filePath));
}

for (const dirPath of directoriesToScan) {
    scanDirectory(path.join(rootDir, dirPath));
}

const rntpPatchPath = path.join(
    rootDir,
    'patches',
    'react-native-track-player+4.1.1.patch',
);
if (existsSync(rntpPatchPath)) {
    errors.push(`RNTP patch must be removed: ${relative(rntpPatchPath)}`);
}

if (errors.length > 0) {
    console.error('Round 20 RNTP removal audit failed:');
    for (const error of errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

console.log('Round 20 RNTP removal audit passed.');

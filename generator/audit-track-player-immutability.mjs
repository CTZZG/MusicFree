import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const trackPlayerPath = path.join(
    rootDir,
    'src',
    'core',
    'trackPlayer',
    'index.ts',
);

const source = readFileSync(trackPlayerPath, 'utf8');
const errors = [];

function requireToken(label, token) {
    if (!source.includes(token)) {
        errors.push(`${label} missing token: ${token}`);
    }
}

function forbidPattern(label, pattern) {
    const matches = source
        .split(/\r?\n/)
        .map((line, index) => ({line, number: index + 1}))
        .filter(({line}) => pattern.test(line));

    for (const match of matches) {
        errors.push(`${label} at ${path.relative(rootDir, trackPlayerPath)}:${match.number}: ${match.line.trim()}`);
    }
}

forbidPattern(
    'TrackPlayer must not write queue timestamp symbols onto input media items',
    /\b(?:musicItem|item|it)\s*\[\s*(?:timeStampSymbol|sortIndexSymbol)\s*\]\s*=/,
);
forbidPattern(
    'TrackPlayer must not patch artwork by mutating the input music item',
    /\bmusicItem\.artwork\s*=(?!=)/,
);

requireToken(
    'addAll immutable queue item clone',
    'const queueMusicItems = musicItems.map',
);
requireToken(
    'addAll timestamp clone property',
    '[timeStampSymbol]: now',
);
requireToken(
    'addAll sort-index clone property',
    '[sortIndexSymbol]: index',
);
requireToken(
    'playWithReplacePlayList immutable queue clone',
    'const writablePlayList = newPlayList.map',
);
requireToken(
    'setCurrentMusic immutable artwork fallback',
    'const normalizedMusicItem =',
);
requireToken(
    'mergeTrackSource immutable merge',
    '...(props ?? {})',
);

if (errors.length > 0) {
    console.error('TrackPlayer immutability audit failed:');
    for (const error of errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

console.log('TrackPlayer immutability audit passed.');

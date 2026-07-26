import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const specsDir = path.join(
    rootDir,
    'node_modules',
    'react-native-nitro-player',
    'src',
    'specs',
);
const specPath = path.join(
    specsDir,
    'TrackPlayer.nitro.ts',
);
const adapterTypesPath = path.join(
    rootDir,
    'src',
    'core',
    'playerAdapter',
    'types.ts',
);
const nitroAdapterPath = path.join(
    rootDir,
    'src',
    'core',
    'playerAdapter',
    'nitroPlayerAdapter.ts',
);
const androidPlayerExtensionsPath = path.join(
    rootDir,
    'node_modules',
    'react-native-nitro-player',
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
);
const iosQueueBuildPath = path.join(
    rootDir,
    'node_modules',
    'react-native-nitro-player',
    'ios',
    'core',
    'TrackPlayerQueueBuild.swift',
);
const iosResourceLoaderPath = path.join(
    rootDir,
    'node_modules',
    'react-native-nitro-player',
    'ios',
    'core',
    'TrackPlayerRedirectResolver.swift',
);

function readProjectFile(filePath) {
    try {
        return readFileSync(filePath, 'utf8');
    } catch (error) {
        console.error(`Failed to read ${path.relative(rootDir, filePath)}`);
        console.error(error.message);
        process.exit(1);
    }
}

function getSection(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    if (start === -1) {
        throw new Error(`Could not find ${startMarker}`);
    }
    const end = endMarker ? source.indexOf(endMarker, start) : source.length;
    if (endMarker && end === -1) {
        throw new Error(`Could not find ${endMarker}`);
    }
    return source.slice(start, end);
}

function extractMethods(section) {
    const methods = new Set();
    const methodPattern = /^ {2}([A-Za-z_]\w*)\s*\(/gm;
    let match;
    while ((match = methodPattern.exec(section))) {
        methods.add(match[1]);
    }
    return [...methods].sort();
}

function scopedMethods(methods, status, target, note) {
    return Object.fromEntries(
        methods.map(method => [
            method,
            {
                status,
                target,
                note,
            },
        ]),
    );
}

const expected = {
    PlayerQueue: {
        addTrackToPlaylist: {
            status: 'mapped',
            target: 'PlayerAdapter.addQueueTrack',
            evidence: ['addQueueTrack', 'PlayerQueue.addTrackToPlaylist'],
        },
        addTracksToPlaylist: {
            status: 'mapped',
            target: 'PlayerAdapter.addQueueTracks / loadQueue',
            evidence: ['addQueueTracks', 'PlayerQueue.addTracksToPlaylist'],
        },
        createPlaylist: {
            status: 'mapped',
            target: 'PlayerAdapter.createQueueInfo / loadQueue',
            evidence: ['createQueueInfo', 'PlayerQueue.createPlaylist'],
        },
        deletePlaylist: {
            status: 'mapped',
            target: 'PlayerAdapter.deleteQueueInfo / reset',
            evidence: ['deleteQueueInfo', 'PlayerQueue.deletePlaylist'],
        },
        getAllPlaylists: {
            status: 'mapped',
            target: 'PlayerAdapter.getAllQueueInfos',
            evidence: ['getAllQueueInfos', 'PlayerQueue.getAllPlaylists'],
        },
        getCurrentPlaylistId: {
            status: 'mapped',
            target: 'PlayerAdapter.getCurrentQueueId',
            evidence: ['getCurrentQueueId', 'PlayerQueue.getCurrentPlaylistId'],
        },
        getPlaylist: {
            status: 'mapped',
            target: 'PlayerAdapter.getQueueInfo',
            evidence: ['getQueueInfo', 'PlayerQueue.getPlaylist'],
        },
        loadPlaylist: {
            status: 'mapped',
            target: 'PlayerAdapter.loadQueueInfo / loadQueue',
            evidence: ['loadQueueInfo', 'PlayerQueue.loadPlaylist'],
        },
        onPlaylistChanged: {
            status: 'mapped',
            target: 'PlayerAdapter.queueChanged',
            evidence: ['queueChanged', 'PlayerQueue.onPlaylistChanged'],
        },
        onPlaylistsChanged: {
            status: 'mapped',
            target: 'PlayerAdapter.queuesChanged',
            evidence: ['queuesChanged', 'PlayerQueue.onPlaylistsChanged'],
        },
        removeTrackFromPlaylist: {
            status: 'mapped',
            target: 'PlayerAdapter.removeQueueTrack',
            evidence: ['removeQueueTrack', 'PlayerQueue.removeTrackFromPlaylist'],
        },
        reorderTrackInPlaylist: {
            status: 'mapped',
            target: 'PlayerAdapter.reorderQueueTrack',
            evidence: ['reorderQueueTrack', 'PlayerQueue.reorderTrackInPlaylist'],
        },
        updatePlaylist: {
            status: 'mapped',
            target: 'PlayerAdapter.updateQueueInfo',
            evidence: ['updateQueueInfo', 'PlayerQueue.updatePlaylist'],
        },
    },
    TrackPlayer: {
        addToUpNext: {
            status: 'mapped',
            target: 'PlayerAdapter.addToUpNext',
            evidence: ['addToUpNext', 'NitroTrackPlayer.addToUpNext'],
        },
        clearPlayNext: {
            status: 'mapped',
            target: 'PlayerAdapter.clearPlayNext',
            evidence: ['clearPlayNext', 'NitroTrackPlayer.clearPlayNext'],
        },
        clearUpNext: {
            status: 'mapped',
            target: 'PlayerAdapter.clearUpNext',
            evidence: ['clearUpNext', 'NitroTrackPlayer.clearUpNext'],
        },
        configure: {
            status: 'mapped',
            target: 'PlayerAdapter.configure',
            evidence: ['configure(config', 'NitroTrackPlayer.configure'],
        },
        getActualQueue: {
            status: 'mapped',
            target: 'PlayerAdapter.getQueue',
            evidence: ['getQueue()', 'NitroTrackPlayer.getActualQueue'],
        },
        getCurrentTrackIndex: {
            status: 'mapped',
            target: 'PlayerAdapter.getActiveTrackIndex',
            evidence: ['getActiveTrackIndex', 'NitroTrackPlayer.getCurrentTrackIndex'],
        },
        getNextTracks: {
            status: 'mapped',
            target: 'PlayerAdapter.getNextTracks',
            evidence: ['getNextTracks', 'NitroTrackPlayer.getNextTracks'],
        },
        getPlaybackSpeed: {
            status: 'mapped',
            target: 'PlayerAdapter.getRate',
            evidence: ['getRate()', 'NitroTrackPlayer.getPlaybackSpeed'],
        },
        getPlayNextQueue: {
            status: 'mapped',
            target: 'PlayerAdapter.getPlayNextQueue',
            evidence: ['getPlayNextQueue', 'NitroTrackPlayer.getPlayNextQueue'],
        },
        getRepeatMode: {
            status: 'mapped',
            target: 'PlayerAdapter.getRepeatMode',
            evidence: ['getRepeatMode', 'NitroTrackPlayer.getRepeatMode'],
        },
        getState: {
            status: 'mapped',
            target: 'PlayerAdapter.getState / getProgress / getActiveTrack',
            evidence: ['getState()', 'NitroTrackPlayer.getState'],
        },
        getTracksById: {
            status: 'mapped',
            target: 'PlayerAdapter.getTracksById',
            evidence: ['getTracksById', 'NitroTrackPlayer.getTracksById'],
        },
        getTracksNeedingUrls: {
            status: 'mapped',
            target: 'PlayerAdapter.getTracksNeedingUrls',
            evidence: ['getTracksNeedingUrls', 'NitroTrackPlayer.getTracksNeedingUrls'],
        },
        getUpNextQueue: {
            status: 'mapped',
            target: 'PlayerAdapter.getUpNextQueue',
            evidence: ['getUpNextQueue', 'NitroTrackPlayer.getUpNextQueue'],
        },
        isAndroidAutoConnected: {
            status: 'mapped',
            target: 'PlayerAdapter.isAndroidAutoConnected',
            evidence: ['isAndroidAutoConnected', 'NitroTrackPlayer.isAndroidAutoConnected'],
        },
        onAndroidAutoConnectionChange: {
            status: 'mapped',
            target: 'PlayerAdapter.androidAutoConnectionChanged',
            evidence: [
                'androidAutoConnectionChanged',
                'NitroTrackPlayer.onAndroidAutoConnectionChange',
            ],
        },
        onChangeTrack: {
            status: 'mapped',
            target: 'PlayerAdapter.trackChanged / playEnd',
            evidence: ['trackChanged', 'NitroTrackPlayer.onChangeTrack'],
        },
        onPlaybackProgressChange: {
            status: 'mapped',
            target: 'PlayerAdapter.progress',
            evidence: ['progress', 'NitroTrackPlayer.onPlaybackProgressChange'],
        },
        onPlaybackStateChange: {
            status: 'partial',
            target: 'PlayerAdapter.playbackStateChanged / playbackError',
            evidence: ['playbackStateChanged', 'nitro-playback-error'],
            note: 'Known gap: JS payload lacks raw Media3 error code/name/message.',
        },
        onSeek: {
            status: 'mapped',
            target: 'PlayerAdapter.playbackSeeked',
            evidence: ['playbackSeeked', 'NitroTrackPlayer.onSeek'],
        },
        onTemporaryQueueChange: {
            status: 'mapped',
            target: 'PlayerAdapter.temporaryQueueChanged',
            evidence: ['temporaryQueueChanged', 'NitroTrackPlayer.onTemporaryQueueChange'],
        },
        onTracksNeedUpdate: {
            status: 'mapped',
            target: 'PlayerAdapter.tracksNeedUpdate',
            evidence: ['tracksNeedUpdate', 'NitroTrackPlayer.onTracksNeedUpdate'],
        },
        pause: {
            status: 'mapped',
            target: 'PlayerAdapter.pause',
            evidence: ['pause()', 'NitroTrackPlayer.pause'],
        },
        play: {
            status: 'mapped',
            target: 'PlayerAdapter.play',
            evidence: ['play()', 'NitroTrackPlayer.play'],
        },
        playNext: {
            status: 'mapped',
            target: 'PlayerAdapter.playNext',
            evidence: ['playNext', 'NitroTrackPlayer.playNext'],
        },
        playSong: {
            status: 'mapped',
            target: 'PlayerAdapter.playTrack / loadQueue',
            evidence: ['playTrack', 'NitroTrackPlayer.playSong'],
        },
        removeFromPlayNext: {
            status: 'mapped',
            target: 'PlayerAdapter.removeFromPlayNext',
            evidence: ['removeFromPlayNext', 'NitroTrackPlayer.removeFromPlayNext'],
        },
        removeFromUpNext: {
            status: 'mapped',
            target: 'PlayerAdapter.removeFromUpNext',
            evidence: ['removeFromUpNext', 'NitroTrackPlayer.removeFromUpNext'],
        },
        reorderTemporaryTrack: {
            status: 'mapped',
            target: 'PlayerAdapter.reorderTemporaryTrack',
            evidence: [
                'reorderTemporaryTrack',
                'NitroTrackPlayer.reorderTemporaryTrack',
            ],
        },
        seek: {
            status: 'mapped',
            target: 'PlayerAdapter.seekTo',
            evidence: ['seekTo', 'NitroTrackPlayer.seek'],
        },
        setPlaybackSpeed: {
            status: 'mapped',
            target: 'PlayerAdapter.setRate',
            evidence: ['setRate', 'NitroTrackPlayer.setPlaybackSpeed'],
        },
        setRepeatMode: {
            status: 'mapped',
            target: 'PlayerAdapter.setRepeatMode',
            evidence: ['setRepeatMode', 'NitroTrackPlayer.setRepeatMode'],
        },
        setVolume: {
            status: 'mapped',
            target: 'PlayerAdapter.setVolume',
            evidence: ['setVolume', 'NitroTrackPlayer.setVolume'],
        },
        skipToIndex: {
            status: 'mapped',
            target: 'PlayerAdapter.skipToIndex',
            evidence: ['skipToIndex', 'NitroTrackPlayer.skipToIndex'],
        },
        skipToNext: {
            status: 'mapped',
            target: 'PlayerAdapter.skipToNext',
            evidence: ['skipToNext', 'NitroTrackPlayer.skipToNext'],
        },
        skipToPrevious: {
            status: 'mapped',
            target: 'PlayerAdapter.skipToPrevious',
            evidence: ['skipToPrevious', 'NitroTrackPlayer.skipToPrevious'],
        },
        updateTracks: {
            status: 'mapped',
            target: 'PlayerAdapter.updateTracks / updateTrack',
            evidence: ['updateTracks', 'NitroTrackPlayer.updateTracks'],
        },
    },
    AndroidAutoMediaLibrary: scopedMethods(
        ['clearMediaLibrary', 'setMediaLibrary'],
        'deferred',
        'No MusicFree Android Auto media-library adapter yet',
        'Tracked for Nitro upgrade parity; not required for the current Android Media3/FFmpeg format gate.',
    ),
    AudioDevices: scopedMethods(
        ['getAudioDevices', 'setAudioDevice'],
        'deferred',
        'No MusicFree audio-device routing adapter yet',
        'Tracked for Nitro upgrade parity; MusicFree currently relies on platform routing and MediaSession.',
    ),
    AudioRoutePicker: scopedMethods(
        ['showRoutePicker'],
        'platform-scoped',
        'iOS-only Nitro route picker',
        'Tracked for Nitro upgrade parity; Round 20 Media3/FFmpeg work is Android-focused.',
    ),
    Cast: scopedMethods(
        [
            'configure',
            'endCastSession',
            'getCastDeviceName',
            'getCastState',
            'isCasting',
            'onCastStateChange',
            'showCastPicker',
        ],
        'deferred',
        'No MusicFree Google Cast adapter yet',
        'Added by Nitro Player 1.5.0; the dependency upgrade keeps the existing PlayerAdapter surface unchanged.',
    ),
    DownloadManager: scopedMethods(
        [
            'cancelAllDownloads',
            'cancelDownload',
            'configure',
            'deleteAllDownloads',
            'deleteDownloadedPlaylist',
            'deleteDownloadedTrack',
            'downloadPlaylist',
            'downloadTrack',
            'getActiveDownloads',
            'getAllDownloadedPlaylists',
            'getAllDownloadedTracks',
            'getConfig',
            'getDownloadedPlaylist',
            'getDownloadedTrack',
            'getDownloadState',
            'getDownloadTask',
            'getEffectiveUrl',
            'getLocalPath',
            'getPlaybackSourcePreference',
            'getQueueStatus',
            'getStorageInfo',
            'isDownloading',
            'isPlaylistDownloaded',
            'isPlaylistPartiallyDownloaded',
            'isTrackDownloaded',
            'onDownloadComplete',
            'onDownloadProgress',
            'onDownloadStateChange',
            'pauseAllDownloads',
            'pauseDownload',
            'resumeAllDownloads',
            'resumeDownload',
            'retryDownload',
            'setPlaybackSourcePreference',
            'syncDownloads',
        ],
        'deferred',
        'Existing MusicFree downloader retained',
        'Tracked for Nitro upgrade parity; replacing MusicFree downloader is not part of the current player/format gate.',
    ),
    Equalizer: scopedMethods(
        [
            'applyPreset',
            'deleteCustomPreset',
            'getBandRange',
            'getBands',
            'getBuiltInPresets',
            'getCurrentPresetName',
            'getCustomPresets',
            'getPresets',
            'getState',
            'isEnabled',
            'onBandChange',
            'onEnabledChange',
            'onPresetChange',
            'reset',
            'saveCustomPreset',
            'setAllBandGains',
            'setBandGain',
            'setEnabled',
        ],
        'deferred',
        'No MusicFree equalizer adapter yet',
        'Tracked for Nitro upgrade parity; not required for ALAC/WMA/DSF playback correctness.',
    ),
};

const spec = readProjectFile(specPath);
const adapterEvidence = [
    readProjectFile(adapterTypesPath),
    readProjectFile(nitroAdapterPath),
].join('\n');
const androidPlayerExtensions = readProjectFile(androidPlayerExtensionsPath);
const iosQueueBuild = readProjectFile(iosQueueBuildPath);
const iosResourceLoader = readProjectFile(iosResourceLoaderPath);

const specMethods = {
    PlayerQueue: extractMethods(
        getSection(spec, 'export interface PlayerQueue', 'export type RepeatMode'),
    ),
    TrackPlayer: extractMethods(getSection(spec, 'export interface TrackPlayer')),
    AndroidAutoMediaLibrary: extractMethods(
        readProjectFile(path.join(specsDir, 'AndroidAutoMediaLibrary.nitro.ts')),
    ),
    AudioDevices: extractMethods(
        readProjectFile(path.join(specsDir, 'AudioDevices.nitro.ts')),
    ),
    AudioRoutePicker: extractMethods(
        readProjectFile(path.join(specsDir, 'AudioRoutePicker.nitro.ts')),
    ),
    Cast: extractMethods(
        readProjectFile(path.join(specsDir, 'Cast.nitro.ts')),
    ),
    DownloadManager: extractMethods(
        readProjectFile(path.join(specsDir, 'DownloadManager.nitro.ts')),
    ),
    Equalizer: extractMethods(
        readProjectFile(path.join(specsDir, 'Equalizer.nitro.ts')),
    ),
};

const errors = [];
// The MusicFree-controlled DataSource was reverted on 2026-07-26. What must
// still hold is that Nitro uses Media3's HTTP stack and does not re-enable
// cross-protocol redirects.
if (
    !androidPlayerExtensions.includes(
        'ResolvingDataSource.Factory(DefaultHttpDataSource.Factory())',
    ) ||
    androidPlayerExtensions.includes('MusicFreePublicHttpDataSourceFactory') ||
    androidPlayerExtensions.includes('.setAllowCrossProtocolRedirects(true)')
) {
    errors.push(
        'Nitro Android media transport must use Media3 HTTP data sources, must not reinstate the reverted MusicFree data source, and must not allow cross-protocol redirects.',
    );
}
if (
    !iosQueueBuild.includes('TrackPlayerRedirectResolver.wrap(url)') ||
    !iosQueueBuild.includes('asset.resourceLoader.setDelegate(redirectResolver, queue: redirectResolver.queue)') ||
    !iosResourceLoader.includes('AVAssetResourceLoaderDelegate, URLSessionDataDelegate') ||
    !iosResourceLoader.includes('Only HTTPS remote media URLs are allowed') ||
    !iosResourceLoader.includes('Only same-origin HTTPS redirects are allowed') ||
    !iosResourceLoader.includes('getaddrinfo') ||
    !iosResourceLoader.includes('isBlockedIpv4') ||
    !iosResourceLoader.includes('isBlockedIpv6') ||
    !iosResourceLoader.includes('request.setValue(rangeHeader, forHTTPHeaderField: "Range")') ||
    !iosResourceLoader.includes('request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")')
) {
    errors.push(
        'Nitro iOS media transport must use the MusicFree controlled AVAsset/URLSession loader.',
    );
}
let mapped = 0;
let partial = 0;
let deferred = 0;
let platformScoped = 0;

for (const [moduleName, methods] of Object.entries(specMethods)) {
    const expectedMethods = expected[moduleName];
    const expectedNames = Object.keys(expectedMethods).sort();
    const unknown = methods.filter(method => !expectedMethods[method]);
    const stale = expectedNames.filter(method => !methods.includes(method));

    for (const method of unknown) {
        errors.push(`${moduleName}.${method} has no MusicFree mapping entry.`);
    }
    for (const method of stale) {
        errors.push(`${moduleName}.${method} mapping is stale; method is absent from Nitro spec.`);
    }

    for (const method of methods) {
        const mapping = expectedMethods[method];
        if (!mapping) {
            continue;
        }
        const missingEvidence = (mapping.evidence ?? []).filter(
            token => !adapterEvidence.includes(token),
        );
        if (missingEvidence.length > 0) {
            errors.push(
                `${moduleName}.${method} mapping evidence missing: ${missingEvidence.join(', ')}`,
            );
        }
        switch (mapping.status) {
            case 'mapped':
                mapped += 1;
                break;
            case 'partial':
                partial += 1;
                break;
            case 'deferred':
                deferred += 1;
                break;
            case 'platform-scoped':
                platformScoped += 1;
                break;
            default:
                errors.push(`${moduleName}.${method} has unknown audit status: ${mapping.status}`);
        }
    }
}

console.log('Nitro Player operation audit');
console.log(`Specs: ${path.relative(rootDir, specsDir)}`);
console.log(`Mapped: ${mapped}`);
console.log(`Partial: ${partial}`);
console.log(`Deferred: ${deferred}`);
console.log(`Platform-scoped: ${platformScoped}`);

for (const [moduleName, methods] of Object.entries(specMethods)) {
    console.log(`\n${moduleName}`);
    for (const method of methods) {
        const mapping = expected[moduleName][method];
        if (!mapping) {
            console.log(`  - ${method}: missing`);
            continue;
        }
        const suffix = mapping.note ? ` (${mapping.note})` : '';
        console.log(`  - ${method}: ${mapping.status} -> ${mapping.target}${suffix}`);
    }
}

if (errors.length > 0) {
    console.error('\nAudit failed:');
    for (const error of errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

console.log(
    '\nAudit passed. Known partial/deferred mappings still require product/runtime decisions before Nitro-only completion.',
);

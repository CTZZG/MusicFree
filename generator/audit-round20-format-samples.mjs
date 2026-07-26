import {
    closeSync,
    existsSync,
    openSync,
    readFileSync,
    readSync,
    readdirSync,
    statSync,
} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sampleMatrixPath = path.join(rootDir, 'docs', 'round20-format-sample-matrix.md');
const commonConstPath = path.join(rootDir, 'src', 'constants', 'commonConst.ts');

const sampleRequirements = [
    {
        id: 'm4a-aac-small',
        format: 'M4A/AAC',
        extensions: ['.m4a'],
        mp4AudioCodecs: ['mp4a'],
        requiredForGate3: false,
    },
    {
        id: 'm4a-alac-small',
        format: 'M4A/ALAC',
        extensions: ['.m4a', '.alac'],
        mp4AudioCodecs: ['alac'],
        requiredForGate3: true,
    },
    {
        id: 'm4a-alac-long',
        format: 'M4A/ALAC',
        extensions: ['.m4a', '.alac'],
        mp4AudioCodecs: ['alac'],
        minimumBytes: 10 * 1024 * 1024,
        requiredForGate3: true,
    },
    {
        id: 'wma-v2-small',
        format: 'WMA v2 / ASF',
        extensions: ['.wma', '.asf'],
        codecIds: [0x0161],
        requiredForGate3: true,
    },
    {
        id: 'wma-pro-small',
        format: 'WMA Pro / ASF',
        extensions: ['.wma', '.asf'],
        codecIds: [0x0162],
        requiredForGate3: false,
    },
    {
        id: 'wma-lossless-small',
        format: 'WMA Lossless / ASF',
        extensions: ['.wma', '.asf'],
        codecIds: [0x0163],
        requiredForGate3: false,
    },
    {
        id: 'asf-audio-only',
        format: 'ASF audio-only',
        extensions: ['.asf'],
        requiresAsfAudio: true,
        requiredForGate3: true,
    },
    {
        id: 'dsf-small',
        format: 'DSF',
        extensions: ['.dsf'],
        requiredForGate3: true,
    },
    {
        id: 'dsf-long',
        format: 'DSF',
        extensions: ['.dsf'],
        requiredForGate3: true,
    },
    {
        id: 'mp3-regression',
        format: 'MP3',
        extensions: ['.mp3'],
        requiredForGate3: true,
    },
    {
        id: 'flac-regression',
        format: 'FLAC',
        extensions: ['.flac'],
        requiredForGate3: true,
    },
    {
        id: 'ogg-regression',
        format: 'OGG/Opus',
        extensions: ['.ogg', '.opus'],
        requiredForGate3: true,
    },
];

const targetOutRequirement = {
    id: 'dff-small',
    format: 'DFF/DSDIFF',
    extensions: ['.dff'],
};

const asfGuids = {
    headerObject: '3026b2758e66cf11a6d900aa0062ce6c',
    filePropertiesObject: 'a1dcab8c47a9cf118ee400c00c205365',
    streamPropertiesObject: '9107dcb7b7a9cf118ee600c00c205365',
    dataObject: '3626b2758e66cf11a6d900aa0062ce6c',
    audioMedia: '409e69f84d5bcf11a8fd00805f5c442b',
};

const asfPacketAuditLimit = Math.max(
    1,
    Number(process.env.MUSICFREE_ASF_PACKET_AUDIT_LIMIT ?? 512) || 512,
);

const wmaCodecNames = new Map([
    [0x000a, 'wmavoice'],
    [0x0160, 'wmav1'],
    [0x0161, 'wmav2'],
    [0x0162, 'wmapro'],
    [0x0163, 'wmalossless'],
]);

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

function requireToken(label, source, token) {
    if (!source.includes(token)) {
        errors.push(`${label} missing token: ${token}`);
    }
}

function parseSampleRoots() {
    const fromEnv = process.env.MUSICFREE_FORMAT_SAMPLE_DIRS;
    const roots = fromEnv
        ? fromEnv
            .split(path.delimiter)
            .map(item => item.trim())
            .filter(Boolean)
        : [];
    return [
        rootDir,
        ...roots.map(item => path.resolve(rootDir, item)),
    ];
}

function shouldSkipDirectory(dirName) {
    return [
        '.git',
        '.gradle',
        '.idea',
        '.yarn',
        'android',
        'build',
        'dist',
        'ios',
        'node_modules',
    ].includes(dirName);
}

function readHead(filePath, maxBytes = 1024 * 1024) {
    const size = statSync(filePath).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    const fd = openSync(filePath, 'r');
    try {
        const bytesRead = readSync(fd, buffer, 0, length, 0);
        return buffer.subarray(0, bytesRead);
    } finally {
        closeSync(fd);
    }
}

function readSlice(filePath, position, length) {
    if (length <= 0) {
        return Buffer.alloc(0);
    }
    const buffer = Buffer.alloc(length);
    const fd = openSync(filePath, 'r');
    try {
        const bytesRead = readSync(fd, buffer, 0, length, position);
        return buffer.subarray(0, bytesRead);
    } finally {
        closeSync(fd);
    }
}

function parseMp4AudioInfo(filePath) {
    try {
        const fileSize = statSync(filePath).size;
        const maxBytes = 64 * 1024 * 1024;
        const buffer = fileSize <= maxBytes ? readFileSync(filePath) : readHead(filePath, maxBytes);
        const codecs = new Set();

        function walk(start, end) {
            let offset = start;
            while (offset + 8 <= end && offset + 8 <= buffer.length) {
                const size32 = buffer.readUInt32BE(offset);
                const type = buffer.toString('ascii', offset + 4, offset + 8);
                let headerSize = 8;
                let boxSize = size32;
                if (size32 === 1) {
                    if (offset + 16 > buffer.length) {
                        break;
                    }
                    const largeSize = buffer.readBigUInt64BE(offset + 8);
                    if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
                        break;
                    }
                    boxSize = Number(largeSize);
                    headerSize = 16;
                } else if (size32 === 0) {
                    boxSize = end - offset;
                }
                if (boxSize < headerSize || offset + boxSize > buffer.length) {
                    break;
                }
                const payloadStart = offset + headerSize;
                const payloadEnd = offset + boxSize;
                if (type === 'stsd') {
                    let entryOffset = payloadStart + 8;
                    const entryCount =
                        payloadStart + 8 <= payloadEnd ? buffer.readUInt32BE(payloadStart + 4) : 0;
                    for (let i = 0; i < entryCount && entryOffset + 8 <= payloadEnd; i++) {
                        const entrySize = buffer.readUInt32BE(entryOffset);
                        const entryType = buffer.toString('ascii', entryOffset + 4, entryOffset + 8);
                        if (entryType.trim()) {
                            codecs.add(entryType);
                        }
                        if (entrySize < 8) {
                            break;
                        }
                        entryOffset += entrySize;
                    }
                } else if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) {
                    walk(payloadStart, payloadEnd);
                }
                offset += boxSize;
            }
        }

        walk(0, buffer.length);
        return {codecs: [...codecs].sort(), scannedBytes: buffer.length, fileSize};
    } catch (error) {
        return {error: error.message};
    }
}

function readGuid(buffer, offset) {
    if (offset < 0 || offset + 16 > buffer.length) {
        return null;
    }
    return buffer.subarray(offset, offset + 16).toString('hex');
}

function readUInt64LEAsNumber(buffer, offset) {
    if (offset < 0 || offset + 8 > buffer.length) {
        return null;
    }
    const value = buffer.readBigUInt64LE(offset);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function readLittleEndianUnsignedIntOrNull(buffer, offset) {
    if (offset < 0 || offset + 4 > buffer.length) {
        return null;
    }
    return buffer.readUInt32LE(offset);
}

function readUnsignedByteOrNull(buffer, offset) {
    if (offset < 0 || offset >= buffer.length) {
        return null;
    }
    return buffer[offset];
}

function parseAsfFileProperties(buffer, offset, payloadSize) {
    if (payloadSize < 80) {
        return {error: 'invalid ASF file properties object'};
    }
    const playDuration100Ns = readUInt64LEAsNumber(buffer, offset + 40) ?? 0;
    const packetCount = readUInt64LEAsNumber(buffer, offset + 32) ?? 0;
    const prerollMs = readUInt64LEAsNumber(buffer, offset + 56) ?? 0;
    const minPacketSize = buffer.readUInt32LE(offset + 68);
    const maxPacketSize = buffer.readUInt32LE(offset + 72);
    const packetSize = minPacketSize === maxPacketSize
        ? minPacketSize
        : Math.max(minPacketSize, maxPacketSize);
    return {
        durationUs: Math.max(0, Math.floor(playDuration100Ns / 10) - (prerollMs * 1000)),
        packetSize,
        packetCount,
    };
}

function parseAsfAudioInfo(filePath) {
    let buffer;
    try {
        buffer = readHead(filePath);
    } catch (error) {
        return {error: error.message};
    }
    if (buffer.length < 30 || readGuid(buffer, 0) !== asfGuids.headerObject) {
        return null;
    }

    const headerSize = readUInt64LEAsNumber(buffer, 16);
    if (!headerSize || headerSize < 30) {
        return {error: 'invalid ASF header size'};
    }
    const boundedHeaderSize = Math.min(headerSize, buffer.length);
    let fileProperties = {
        durationUs: 0,
        packetSize: 0,
        packetCount: 0,
    };
    let audioInfo = null;
    let offset = 30;
    while (offset + 24 <= boundedHeaderSize) {
        const objectGuid = readGuid(buffer, offset);
        const objectSize = readUInt64LEAsNumber(buffer, offset + 16);
        if (!objectGuid || !objectSize || objectSize < 24) {
            break;
        }
        if (offset + objectSize > buffer.length) {
            break;
        }

        const dataOffset = offset + 24;
        const payloadSize = objectSize - 24;
        if (objectGuid === asfGuids.filePropertiesObject) {
            const parsedFileProperties = parseAsfFileProperties(buffer, dataOffset, payloadSize);
            if (parsedFileProperties.error) {
                return {error: parsedFileProperties.error};
            }
            fileProperties = parsedFileProperties;
        } else if (objectGuid === asfGuids.streamPropertiesObject && audioInfo == null) {
            const streamType = readGuid(buffer, dataOffset);
            if (streamType === asfGuids.audioMedia) {
                const typeSpecificDataLengthOffset = dataOffset + 40;
                if (typeSpecificDataLengthOffset + 4 > buffer.length) {
                    return {error: 'truncated ASF audio stream properties'};
                }
                const typeSpecificDataLength = buffer.readUInt32LE(typeSpecificDataLengthOffset);
                const typeSpecificDataOffset = dataOffset + 54;
                if (
                    typeSpecificDataLength < 18 ||
                    typeSpecificDataOffset + typeSpecificDataLength > buffer.length
                ) {
                    return {error: 'invalid ASF audio WAVEFORMATEX data'};
                }
                const codecId = buffer.readUInt16LE(typeSpecificDataOffset);
                const channels = buffer.readUInt16LE(typeSpecificDataOffset + 2);
                const sampleRate = buffer.readUInt32LE(typeSpecificDataOffset + 4);
                const averageBytesPerSecond = buffer.readUInt32LE(typeSpecificDataOffset + 8);
                const blockAlign = buffer.readUInt16LE(typeSpecificDataOffset + 12);
                const bitsPerSample = buffer.readUInt16LE(typeSpecificDataOffset + 14);
                const extraDataSize = buffer.readUInt16LE(typeSpecificDataOffset + 16);
                const streamFlags = buffer.readUInt16LE(dataOffset + 48);
                audioInfo = {
                    headerSize,
                    durationUs: fileProperties.durationUs,
                    packetSize: fileProperties.packetSize,
                    packetCount: fileProperties.packetCount,
                    streamNumber: streamFlags & 0x7f,
                    codecId,
                    codecHex: `0x${codecId.toString(16).padStart(4, '0')}`,
                    codecName: wmaCodecNames.get(codecId) ?? 'unknown',
                    channels,
                    sampleRate,
                    averageBytesPerSecond,
                    blockAlign,
                    bitsPerSample,
                    extraDataSize,
                };
            }
        }

        offset += objectSize;
    }
    if (!audioInfo) {
        return {error: 'no ASF audio stream properties found'};
    }
    return {
        ...audioInfo,
        durationUs: fileProperties.durationUs,
        packetSize: fileProperties.packetSize,
        packetCount: fileProperties.packetCount,
    };
}

class AsfPacketCursor {
    constructor(data, limit) {
        this.data = data;
        this.limit = limit;
        this.position = 0;
    }

    readUnsignedByte() {
        this.ensureAvailable(1);
        return this.data[this.position++];
    }

    readLittleEndianUnsignedShort() {
        this.ensureAvailable(2);
        const value = this.data.readUInt16LE(this.position);
        this.position += 2;
        return value;
    }

    readLittleEndianUnsignedInt() {
        this.ensureAvailable(4);
        const value = this.data.readUInt32LE(this.position);
        this.position += 4;
        return value;
    }

    readVariableLength(type) {
        switch (type) {
            case 0:
                return 0;
            case 1:
                return this.readUnsignedByte();
            case 2:
                return this.readLittleEndianUnsignedShort();
            case 3:
                return this.readLittleEndianUnsignedInt();
            default:
                throw new Error('Invalid ASF length type.');
        }
    }

    readBytes(size) {
        if (size < 0) {
            throw new Error('Invalid ASF byte count.');
        }
        this.ensureAvailable(size);
        const bytes = this.data.subarray(this.position, this.position + size);
        this.position += size;
        return bytes;
    }

    skip(size) {
        if (size < 0) {
            throw new Error('Invalid ASF skip count.');
        }
        this.ensureAvailable(size);
        this.position += size;
    }

    ensureAvailable(size) {
        if (this.position + size > this.limit) {
            throw new Error('Truncated ASF packet.');
        }
    }
}

function errorCorrectionDataLength(errorCorrectionFlags) {
    return (errorCorrectionFlags & 0x80) === 0 ? 0 : errorCorrectionFlags & 0x0f;
}

function parseAsfPacket(packet, declaredPacketSize, audioStreamNumber) {
    const packetSize = declaredPacketSize > 0 ? declaredPacketSize : packet.length;
    if (packetSize <= 0 || packetSize > packet.length) {
        throw new Error('Invalid ASF packet size.');
    }

    const cursor = new AsfPacketCursor(packet, packetSize);
    const errorCorrectionFlags = cursor.readUnsignedByte();
    cursor.skip(errorCorrectionDataLength(errorCorrectionFlags));

    const lengthTypeFlags = cursor.readUnsignedByte();
    const propertyFlags = cursor.readUnsignedByte();

    const packetLength = cursor.readVariableLength((lengthTypeFlags & 0x60) >>> 5);
    const sequence = cursor.readVariableLength((lengthTypeFlags & 0x06) >>> 1);
    const paddingLength = cursor.readVariableLength((lengthTypeFlags & 0x18) >>> 3);
    const sendTimeMs = cursor.readLittleEndianUnsignedInt();
    const durationMs = cursor.readLittleEndianUnsignedShort();

    const actualPacketLength = packetLength > 0 ? packetLength : packetSize;
    if (actualPacketLength > packetSize) {
        throw new Error('ASF packet length exceeds available packet bytes.');
    }
    const payloadEnd = actualPacketLength - paddingLength;
    if (payloadEnd < cursor.position || payloadEnd > actualPacketLength) {
        throw new Error('Invalid ASF packet padding length.');
    }

    const streamNumberLengthType = (propertyFlags & 0xc0) >>> 6;
    const mediaObjectNumberLengthType = (propertyFlags & 0x30) >>> 4;
    const offsetIntoMediaObjectLengthType = (propertyFlags & 0x0c) >>> 2;
    const replicatedDataLengthType = propertyFlags & 0x03;

    const hasMultiplePayloads = (lengthTypeFlags & 0x01) !== 0;
    let payloadCount;
    let payloadLengthType;
    if (hasMultiplePayloads) {
        const payloadFlags = cursor.readUnsignedByte();
        payloadCount = payloadFlags & 0x3f;
        payloadLengthType = (payloadFlags & 0xc0) >>> 6;
    } else {
        payloadCount = 1;
        payloadLengthType = 0;
    }

    if (payloadCount <= 0) {
        throw new Error('ASF packet does not contain payloads.');
    }

    const payloads = [];
    for (let index = 0; index < payloadCount; index += 1) {
        const streamNumberRaw = cursor.readVariableLength(streamNumberLengthType);
        const mediaObjectNumber = cursor.readVariableLength(mediaObjectNumberLengthType);
        const offsetIntoMediaObject = cursor.readVariableLength(offsetIntoMediaObjectLengthType);
        const replicatedDataLength = cursor.readVariableLength(replicatedDataLengthType);
        const replicatedData = cursor.readBytes(replicatedDataLength);

        const payloadDataLength = hasMultiplePayloads
            ? cursor.readVariableLength(payloadLengthType)
            : payloadEnd - cursor.position;
        if (payloadDataLength < 0 || cursor.position + payloadDataLength > payloadEnd) {
            throw new Error('Invalid ASF payload data length.');
        }

        const streamNumber = streamNumberRaw & 0x7f;
        const payloadData = cursor.readBytes(payloadDataLength);
        payloads.push({
            streamNumber,
            encrypted: (streamNumberRaw & 0x80) !== 0,
            mediaObjectNumber,
            offsetIntoMediaObject,
            replicatedData,
            mediaObjectSize: readLittleEndianUnsignedIntOrNull(replicatedData, 0),
            presentationTimeMs: readLittleEndianUnsignedIntOrNull(replicatedData, 4),
            presentationTimeDeltaMs: readUnsignedByteOrNull(replicatedData, 0),
            payloadData,
            targetAudioStream: streamNumber === audioStreamNumber,
            compressedPayload: replicatedDataLength === 1,
        });
    }

    return {
        sequence,
        sendTimeMs,
        durationMs,
        paddingLength,
        payloads,
    };
}

function createAsfWmaPayloadAssembler() {
    const pendingMediaObjects = new Map();
    const toTimeUs = timeMs => Math.max(0, timeMs * 1000);

    function consumeStandardPayload(packet, payload) {
        const mediaObjectSize = payload.mediaObjectSize;
        if (mediaObjectSize == null) {
            return [{
                timeUs: toTimeUs(payload.presentationTimeMs ?? packet.sendTimeMs),
                mediaObjectNumber: payload.mediaObjectNumber,
                size: payload.payloadData.length,
                compressedPayload: false,
            }];
        }
        if (mediaObjectSize <= 0 || mediaObjectSize > Number.MAX_SAFE_INTEGER) {
            throw new Error('Invalid ASF/WMA media object size.');
        }

        let pending;
        if (payload.offsetIntoMediaObject === 0) {
            pending = {
                mediaObjectNumber: payload.mediaObjectNumber,
                expectedSize: mediaObjectSize,
                timeUs: toTimeUs(payload.presentationTimeMs ?? packet.sendTimeMs),
                size: 0,
            };
            pendingMediaObjects.set(payload.mediaObjectNumber, pending);
        } else {
            pending = pendingMediaObjects.get(payload.mediaObjectNumber);
            if (!pending) {
                throw new Error('Missing initial ASF/WMA media object fragment.');
            }
        }

        if (payload.offsetIntoMediaObject !== pending.size) {
            throw new Error('Non-sequential ASF/WMA media object fragments are not supported.');
        }
        if (pending.size + payload.payloadData.length > pending.expectedSize) {
            throw new Error('ASF/WMA media object fragment exceeds expected size.');
        }

        pending.size += payload.payloadData.length;
        if (pending.size !== pending.expectedSize) {
            return [];
        }

        pendingMediaObjects.delete(payload.mediaObjectNumber);
        return [{
            timeUs: pending.timeUs,
            mediaObjectNumber: pending.mediaObjectNumber,
            size: pending.size,
            compressedPayload: false,
        }];
    }

    function consumeCompressedPayload(packet, payload) {
        const presentationTimeDeltaMs = payload.presentationTimeDeltaMs;
        if (presentationTimeDeltaMs == null) {
            throw new Error('Missing ASF/WMA compressed payload time delta.');
        }
        const basePresentationTimeMs = payload.offsetIntoMediaObject;
        const samples = [];
        let position = 0;
        let subPayloadIndex = 0;
        while (position < payload.payloadData.length) {
            const subPayloadSize = payload.payloadData[position];
            position += 1;
            if (subPayloadSize <= 0 || position + subPayloadSize > payload.payloadData.length) {
                throw new Error('Invalid ASF/WMA compressed sub-payload size.');
            }
            const timeMs =
                basePresentationTimeMs +
                    (presentationTimeDeltaMs * subPayloadIndex);
            samples.push({
                timeUs: toTimeUs(timeMs > 0 ? timeMs : packet.sendTimeMs),
                mediaObjectNumber: payload.mediaObjectNumber + subPayloadIndex,
                size: subPayloadSize,
                compressedPayload: true,
            });
            position += subPayloadSize;
            subPayloadIndex += 1;
        }
        return samples;
    }

    return {
        consume(packet) {
            const samples = [];
            for (const payload of packet.payloads) {
                if (!payload.targetAudioStream) {
                    continue;
                }
                if (payload.encrypted) {
                    throw new Error('Encrypted ASF/WMA payloads are not supported.');
                }
                if (payload.compressedPayload) {
                    samples.push(...consumeCompressedPayload(packet, payload));
                } else {
                    samples.push(...consumeStandardPayload(packet, payload));
                }
            }
            return samples;
        },
        get pendingCount() {
            return pendingMediaObjects.size;
        },
    };
}

function parseAsfDataObjectHeader(filePath, headerSize) {
    const dataHeader = readSlice(filePath, headerSize, 50);
    if (dataHeader.length < 50) {
        return {error: 'truncated ASF data object header'};
    }
    if (readGuid(dataHeader, 0) !== asfGuids.dataObject) {
        return {error: 'invalid ASF data object'};
    }
    const objectSize = readUInt64LEAsNumber(dataHeader, 16);
    if (!objectSize || objectSize < 50) {
        return {error: 'invalid ASF data object size'};
    }
    return {
        objectSize,
        packetCount: readUInt64LEAsNumber(dataHeader, 40) ?? 0,
        firstPacketOffset: 50,
    };
}

function analyzeAsfPackets(filePath, asfAudio) {
    try {
        if (!asfAudio.headerSize || !asfAudio.packetSize || !asfAudio.streamNumber) {
            return {error: 'missing ASF packet metadata'};
        }
        const dataObject = parseAsfDataObjectHeader(filePath, asfAudio.headerSize);
        if (dataObject.error) {
            return {error: dataObject.error};
        }
        const fileSize = statSync(filePath).size;
        const dataStartOffset = asfAudio.headerSize + dataObject.firstPacketOffset;
        const packetsByFileSize = Math.max(0, Math.floor((fileSize - dataStartOffset) / asfAudio.packetSize));
        const declaredPackets =
            dataObject.packetCount > 0
                ? dataObject.packetCount
                : asfAudio.packetCount;
        const packetBudget =
            declaredPackets > 0
                ? Math.min(declaredPackets, packetsByFileSize, asfPacketAuditLimit)
                : Math.min(packetsByFileSize, asfPacketAuditLimit);
        if (packetBudget <= 0) {
            return {error: 'no ASF packets available for audit'};
        }

        const assembler = createAsfWmaPayloadAssembler();
        const stats = {
            packetSize: asfAudio.packetSize,
            declaredPackets,
            dataObjectPackets: dataObject.packetCount,
            packetsByFileSize,
            packetsParsed: 0,
            totalPayloads: 0,
            targetPayloads: 0,
            encryptedPayloads: 0,
            compressedPayloads: 0,
            samples: 0,
            compressedSamples: 0,
            standardSamples: 0,
            sampleBytes: 0,
            firstTimeUs: null,
            lastTimeUs: null,
            maxPayloadsPerPacket: 0,
            pendingMediaObjects: 0,
        };

        for (let packetIndex = 0; packetIndex < packetBudget; packetIndex += 1) {
            const packetOffset = dataStartOffset + (packetIndex * asfAudio.packetSize);
            const packetBytes = readSlice(filePath, packetOffset, asfAudio.packetSize);
            if (packetBytes.length < asfAudio.packetSize) {
                return {error: `packet ${packetIndex} truncated`};
            }
            let packet;
            try {
                packet = parseAsfPacket(packetBytes, asfAudio.packetSize, asfAudio.streamNumber);
            } catch (error) {
                return {error: `packet ${packetIndex}: ${error.message}`};
            }

            stats.packetsParsed += 1;
            stats.totalPayloads += packet.payloads.length;
            stats.maxPayloadsPerPacket = Math.max(stats.maxPayloadsPerPacket, packet.payloads.length);
            for (const payload of packet.payloads) {
                if (payload.encrypted) {
                    stats.encryptedPayloads += 1;
                }
                if (payload.targetAudioStream) {
                    stats.targetPayloads += 1;
                    if (payload.compressedPayload) {
                        stats.compressedPayloads += 1;
                    }
                }
            }

            let samples;
            try {
                samples = assembler.consume(packet);
            } catch (error) {
                return {error: `packet ${packetIndex}: ${error.message}`};
            }
            for (const sample of samples) {
                stats.samples += 1;
                stats.sampleBytes += sample.size;
                if (sample.compressedPayload) {
                    stats.compressedSamples += 1;
                } else {
                    stats.standardSamples += 1;
                }
                stats.firstTimeUs =
                    stats.firstTimeUs == null
                        ? sample.timeUs
                        : Math.min(stats.firstTimeUs, sample.timeUs);
                stats.lastTimeUs =
                    stats.lastTimeUs == null
                        ? sample.timeUs
                        : Math.max(stats.lastTimeUs, sample.timeUs);
            }
        }

        stats.pendingMediaObjects = assembler.pendingCount;
        if (stats.targetPayloads <= 0 || stats.samples <= 0) {
            return {
                ...stats,
                error: 'no target ASF/WMA samples produced in audited packets',
            };
        }
        return stats;
    } catch (error) {
        return {error: error.message};
    }
}

function scanMediaFiles(roots) {
    const wantedExtensions = new Set([
        ...sampleRequirements.flatMap(item => item.extensions),
        ...targetOutRequirement.extensions,
    ]);
    const found = [];
    const visited = new Set();

    for (const root of roots) {
        if (!existsSync(root)) {
            warnings.push(`Sample root does not exist: ${root}`);
            continue;
        }
        const stack = [root];
        while (stack.length > 0) {
            const current = stack.pop();
            const resolved = path.resolve(current);
            if (visited.has(resolved)) {
                continue;
            }
            visited.add(resolved);
            let entries;
            try {
                entries = readdirSync(current, {withFileTypes: true});
            } catch {
                continue;
            }
            for (const entry of entries) {
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    if (!shouldSkipDirectory(entry.name)) {
                        stack.push(fullPath);
                    }
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                const ext = path.extname(entry.name).toLowerCase();
                if (!wantedExtensions.has(ext)) {
                    continue;
                }
                let size = 0;
                try {
                    size = statSync(fullPath).size;
                } catch {
                    // Leave size as 0; the path is still useful as an inventory hint.
                }
                const asfAudio =
                    ext === '.asf' || ext === '.wma'
                        ? parseAsfAudioInfo(fullPath)
                        : null;
                const mp4Audio =
                    ext === '.m4a' || ext === '.alac'
                        ? parseMp4AudioInfo(fullPath)
                        : null;
                const asfPacket =
                    asfAudio && !asfAudio.error
                        ? analyzeAsfPackets(fullPath, asfAudio)
                        : null;
                found.push({path: fullPath, ext, size, asfAudio, asfPacket, mp4Audio});
            }
        }
    }
    return found;
}

function matchesRequirement(requirement, file) {
    if (!requirement.extensions.includes(file.ext)) {
        return false;
    }
    if (requirement.requiresAsfAudio) {
        return Boolean(file.asfAudio && !file.asfAudio.error);
    }
    if (requirement.minimumBytes && file.size < requirement.minimumBytes) {
        return false;
    }
    if (requirement.mp4AudioCodecs) {
        return Boolean(
            file.mp4Audio &&
                !file.mp4Audio.error &&
                requirement.mp4AudioCodecs.some(codec => file.mp4Audio.codecs.includes(codec)),
        );
    }
    if (requirement.codecIds) {
        return Boolean(
            file.asfAudio &&
                !file.asfAudio.error &&
                requirement.codecIds.includes(file.asfAudio.codecId),
        );
    }
    return true;
}

function summarizeMp4Audio(files) {
    const mp4Files = files.filter(file => file.ext === '.m4a' || file.ext === '.alac');
    if (mp4Files.length === 0) {
        return [];
    }
    return mp4Files.map(file => {
        const label = path.basename(file.path);
        if (!file.mp4Audio) {
            return `${label}: not parsed`;
        }
        if (file.mp4Audio.error) {
            return `${label}: ${file.mp4Audio.error}`;
        }
        return `${label}: codecs=${file.mp4Audio.codecs.join(',') || 'none'} scanned=${file.mp4Audio.scannedBytes}/${file.mp4Audio.fileSize}`;
    });
}

function summarizeByExtension(files) {
    const counts = new Map();
    for (const file of files) {
        counts.set(file.ext, (counts.get(file.ext) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([ext, count]) => `${ext}:${count}`)
        .join(', ') || 'none';
}

function summarizeAsfAudio(files) {
    const asfFiles = files.filter(file => file.ext === '.asf' || file.ext === '.wma');
    if (asfFiles.length === 0) {
        return [];
    }
    return asfFiles.map(file => {
        const label = path.basename(file.path);
        if (!file.asfAudio) {
            return `${label}: not parsed`;
        }
        if (file.asfAudio.error) {
            return `${label}: ${file.asfAudio.error}`;
        }
        const parts = [
            `${label}: ${file.asfAudio.codecName}`,
            file.asfAudio.codecHex,
            `${file.asfAudio.channels}ch`,
            `${file.asfAudio.sampleRate}Hz`,
            `extra=${file.asfAudio.extraDataSize}`,
            `stream=${file.asfAudio.streamNumber}`,
            `packets=${file.asfAudio.packetCount || '?'}`,
        ];
        if (file.asfPacket) {
            if (file.asfPacket.error) {
                parts.push(`packetAuditError=${file.asfPacket.error}`);
            } else {
                parts.push(
                    `packetAudit=${file.asfPacket.packetsParsed}/${file.asfPacket.declaredPackets || file.asfPacket.packetsByFileSize}`,
                    `payloads=${file.asfPacket.targetPayloads}/${file.asfPacket.totalPayloads}`,
                    `samples=${file.asfPacket.samples}`,
                    `compressedSamples=${file.asfPacket.compressedSamples}`,
                    `pending=${file.asfPacket.pendingMediaObjects}`,
                );
            }
        }
        return parts.join(' ');
    });
}

const matrixSource = read(sampleMatrixPath);
const commonConstSource = read(commonConstPath);

for (const requirement of sampleRequirements) {
    requireToken('Format sample matrix', matrixSource, `| \`${requirement.id}\``);
}
requireToken('Format sample matrix', matrixSource, `| \`${targetOutRequirement.id}\``);
for (const token of [
    'M4A/ALAC',
    'WMA/ASF',
    'DSF',
    'DFF/DSDIFF 不在原始目标内',
    'WAVEFORMATEX',
    'MUSICFREE_FORMAT_SAMPLE_DIRS',
    'MUSICFREE_REQUIRE_FORMAT_SAMPLES',
]) {
    requireToken('Format sample matrix', matrixSource, token);
}

for (const ext of ['.m4a', '.wma', '.asf', '.dsf']) {
    requireToken('supportLocalMediaType', commonConstSource, `"${ext}"`);
}
if (commonConstSource.includes('".dff"')) {
    errors.push('supportLocalMediaType must not include ".dff" while DFF/DSDIFF is target-out.');
}

const sampleRoots = parseSampleRoots();
const mediaFiles = scanMediaFiles(sampleRoots);
for (const file of mediaFiles) {
    if (file.asfPacket?.error) {
        warnings.push(`ASF packet audit warning for ${path.basename(file.path)}: ${file.asfPacket.error}`);
    }
}
const requiredMissing = sampleRequirements
    .filter(requirement => requirement.requiredForGate3)
    .filter(requirement => !mediaFiles.some(file => matchesRequirement(requirement, file)));
const requireSamples = process.env.MUSICFREE_REQUIRE_FORMAT_SAMPLES === '1';

if (requireSamples && requiredMissing.length > 0) {
    for (const requirement of requiredMissing) {
        errors.push(
            `Missing required Gate 3 sample for ${requirement.id} (${requirement.format}); expected one of ${requirement.extensions.join(', ')}`,
        );
    }
} else if (requiredMissing.length > 0) {
    warnings.push(
        `Gate 3 sample coverage incomplete: ${requiredMissing.map(item => item.id).join(', ')}`,
    );
}

if (mediaFiles.some(file => file.ext === '.dff')) {
    warnings.push('DFF/DSDIFF sample file found, but DFF remains target-out and must not be claimed supported.');
}

if (errors.length > 0) {
    console.error('Round 20 format sample audit failed.');
    for (const error of errors) {
        console.error(`- ${error}`);
    }
    process.exit(1);
}

console.log('Round 20 format sample audit');
console.log(`Sample roots: ${sampleRoots.map(root => path.relative(rootDir, root) || '.').join(path.delimiter)}`);
console.log(`Found media samples by extension: ${summarizeByExtension(mediaFiles)}`);
const asfSummaries = summarizeAsfAudio(mediaFiles);
if (asfSummaries.length > 0) {
    console.log('ASF/WMA audio streams:');
    for (const summary of asfSummaries) {
        console.log(`- ${summary}`);
    }
}
const mp4Summaries = summarizeMp4Audio(mediaFiles);
if (mp4Summaries.length > 0) {
    console.log('MP4/M4A audio streams:');
    for (const summary of mp4Summaries) {
        console.log(`- ${summary}`);
    }
}
if (warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of warnings) {
        console.log(`- ${warning}`);
    }
}
console.log(
    requireSamples
        ? 'Gate 3 sample enforcement is enabled.'
        : 'Gate 3 sample enforcement is optional; set MUSICFREE_REQUIRE_FORMAT_SAMPLES=1 to make missing samples fail.',
);

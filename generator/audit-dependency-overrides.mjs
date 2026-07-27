import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fileTypeFromBuffer} from 'file-type';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const expectedFileTypeVersion = '21.3.4';
const expectedUuidVersion = '11.1.1';

const readInstalledPackageVersion = packageName => {
    const packagePath = path.join(
        rootDir,
        'node_modules',
        ...packageName.split('/'),
        'package.json',
    );
    return JSON.parse(readFileSync(packagePath, 'utf8')).version;
};

const uuid = require('uuid');
const xcode = require('xcode');
const {Vibrant} = require('node-vibrant/node');

assert.equal(
    readInstalledPackageVersion('file-type'),
    expectedFileTypeVersion,
    'file-type must stay on the patched ASF parser line',
);
assert.equal(
    readInstalledPackageVersion('uuid'),
    expectedUuidVersion,
    'uuid must stay on the CommonJS-compatible security backport',
);
assert.equal(typeof uuid.v4, 'function', 'uuid must retain the v4 CommonJS API');
assert.equal(
    typeof xcode.project,
    'function',
    'xcode must remain loadable through CommonJS',
);
assert.match(
    uuid.v4(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
assert.throws(
    () => uuid.v5('musicfree', uuid.v5.DNS, new Uint8Array(8), 4),
    RangeError,
    'uuid v5 must reject an out-of-bounds output buffer',
);

const craftedAsf = Buffer.from(
    '3026b2758e66cf11a6d9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    'hex',
);
const detectedAsf = await Promise.race([
    fileTypeFromBuffer(craftedAsf),
    new Promise((_, reject) => {
        setTimeout(
            () => reject(new Error('crafted ASF detection timed out')),
            1000,
        );
    }),
]);
assert.deepEqual(detectedAsf, {
    ext: 'asf',
    mime: 'application/vnd.ms-asf',
});

const bmp = Buffer.alloc(70);
bmp.write('BM', 0);
bmp.writeUInt32LE(70, 2);
bmp.writeUInt32LE(54, 10);
bmp.writeUInt32LE(40, 14);
bmp.writeInt32LE(2, 18);
bmp.writeInt32LE(2, 22);
bmp.writeUInt16LE(1, 26);
bmp.writeUInt16LE(24, 28);
bmp.writeUInt32LE(16, 34);
for (let row = 0; row < 2; row += 1) {
    const rowOffset = 54 + row * 8;
    for (let column = 0; column < 2; column += 1) {
        const pixelOffset = rowOffset + column * 3;
        bmp[pixelOffset] = 0;
        bmp[pixelOffset + 1] = 0;
        bmp[pixelOffset + 2] = 255;
    }
}

const palette = await Vibrant.from(bmp).getPalette();
assert.ok(
    palette.Vibrant?.hex,
    'node-vibrant must still decode an image through the patched Jimp adapter',
);

console.log(
    `Dependency override audit passed: file-type ${expectedFileTypeVersion}, uuid ${expectedUuidVersion}, ASF guard, xcode CommonJS, and Jimp/Vibrant decode verified.`,
);

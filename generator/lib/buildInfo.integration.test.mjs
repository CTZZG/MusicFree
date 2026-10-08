import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import zlib from 'node:zlib';

const generator = fileURLToPath(new URL('../generate-build-info.mjs', import.meta.url));

// 不压缩的 zip，够 unzip -p 读出一个文件
function storedZip(name, data) {
    const fileName = Buffer.from(name);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    const centralOffset = local.length + fileName.length + data.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + fileName.length, 12);
    end.writeUInt32LE(centralOffset, 16);
    return Buffer.concat([local, fileName, data, central, fileName, end]);
}

// 在一份单独的工程里跑真正的生成器，只放它要读的文件
function project(t, dirName) {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'musicfree-build-info-'));
    t.after(() => fs.rmSync(parent, {recursive: true, force: true}));
    const root = path.join(parent, dirName);
    const write = (name, content) => {
        const file = path.join(root, name);
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, content);
    };
    write('package.json', JSON.stringify({version: '1.2.3', dependencies: {}}));
    write('android/app/build.gradle', 'def appVersionCode = 400001\n');
    write('generator/generate-build-info.mjs', fs.readFileSync(generator));
    fs.mkdirSync(path.join(root, 'src', 'constants'), {recursive: true});
    return {root, write};
}

function generate(root) {
    const result = spawnSync(process.execPath, [path.join(root, 'generator', 'generate-build-info.mjs')], {
        cwd: root,
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = fs.readFileSync(path.join(root, 'src', 'constants', 'buildInfo.generated.ts'), 'utf8');
    return JSON.parse(output.match(/export const buildInfo = (\{[\s\S]*?\}) as const;/)[1]);
}

const library = Buffer.concat([
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0]),
    Buffer.from('libmpv\0mpv v0.41.0 Copyright\0', 'latin1'),
]);

for (const dirName of ['MusicFree', 'MusicFree-$review', 'Music Free "x" `y`']) {
    test(`reads the mpv version from the AAR in a project at ${dirName}`, t => {
        const {root, write} = project(t, dirName);
        write('android/app/libs/libmpv-release.aar', storedZip('jni/arm64-v8a/libmpv.so', library));

        assert.equal(generate(root).player, 'mpv v0.41.0');
    });
}

test('records unknown when the AAR is missing', t => {
    const {root} = project(t, 'MusicFree-$review');

    assert.equal(generate(root).player, 'unknown');
});

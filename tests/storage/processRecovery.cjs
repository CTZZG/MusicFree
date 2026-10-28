/* Real product modules and real host files, with process exit at commit boundaries.
 * RNFS is adapted to Node fs only at the platform boundary. This is not an Android
 * filesystem/power-loss claim. No files outside our own mkdtemp are touched.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const marker = 'mf-store-crash-';

function modules(directory, stage) {
    const cache = new Map();
    const primary = path.join(directory, 'kvstore', 's.json');
    const checkpoint = name => { if (stage === name) process.exit(81); };
    const rnfs = {
        DocumentDirectoryPath: directory,
        exists: async file => { try { await fsp.access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } },
        mkdir: async file => { await fsp.mkdir(file, {recursive: true}); },
        readFile: (file, encoding) => fsp.readFile(file, encoding),
        writeFile: async (file, value, encoding) => {
            if (stage === 'temp-partial') { await fsp.writeFile(file, value.slice(0, 7), encoding); process.exit(81); }
            await fsp.writeFile(file, value, encoding);
            checkpoint('temp-complete');
        },
        moveFile: async (from, to) => {
            if (stage === 'primary-partial' && to === primary) {
                await fsp.writeFile(to, '{partial'); process.exit(81);
            }
            await fsp.rename(from, to);
            if (from === primary) checkpoint('primary-rotated');
            if (to === primary) checkpoint('committed');
        },
        unlink: async file => { await fsp.unlink(file); checkpoint('backup-removed'); },
    };
    function load(file) {
        const resolved = path.resolve(root, file.endsWith('.ts') ? file : `${file}.ts`);
        if (cache.has(resolved)) return cache.get(resolved).exports;
        const module = {exports: {}};
        cache.set(resolved, module);
        const source = fs.readFileSync(resolved, 'utf8');
        const code = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true}}).outputText;
        const requireLocal = name => {
            if (name === 'react-native-fs') return rnfs;
            if (name.startsWith('.')) return load(path.resolve(path.dirname(resolved), name));
            throw new Error(`Unexpected product dependency: ${name}`);
        };
        vm.runInThisContext(`(function(require,module,exports){${code}\n})`, {filename: resolved})(requireLocal, module, module.exports);
        return module.exports;
    }
    return {
        Store: load('src/utils/keyValueStore/store').default,
        backend: load('src/utils/keyValueStore/filePersistence').createFilePersistence,
    };
}

async function child(mode, directory, stage) {
    // Parent-created paths only; avoid allowing a typo to select unrelated data.
    assert(path.basename(directory).startsWith(marker));
    const {Store, backend} = modules(directory, stage);
    const store = new Store('s', backend(), {setTimer: () => 0, clearTimer: () => {}});
    try {
        await store.hydrate();
        if (mode === 'write') {
            store.set('data', 'candidate');
            assert.equal(await store.flush(), true);
        } else process.stdout.write(JSON.stringify({value: store.getString('data')}));
    } catch (error) {
        if (mode !== 'read' || error.name !== 'StoreReadError') throw error;
        process.stdout.write(JSON.stringify({blocked: true}));
    }
}

async function parent() {
    const stages = ['temp-partial', 'temp-complete', 'backup-removed', 'primary-rotated', 'primary-partial', 'committed'];
    const results = [];
    const snapshot = value => JSON.stringify({version: 1, entries: {data: {t: 's', v: value}}});
    const cases = [...stages.map(stage => ({stage, first: false})),
        {stage: 'temp-complete', first: true}, {stage: 'temp-partial', first: true}];
    for (const {stage, first} of cases) {
        const directory = await fsp.mkdtemp(path.join(os.tmpdir(), marker));
        try {
            const kv = path.join(directory, 'kvstore');
            await fsp.mkdir(kv);
            if (!first) {
                await fsp.writeFile(path.join(kv, 's.json'), snapshot('last-good'));
                await fsp.writeFile(path.join(kv, 's.json.bak'), snapshot('older'));
            }
            const run = spawnSync(process.execPath, [__filename, '--child', 'write', directory, stage], {encoding: 'utf8', timeout: 15000});
            assert.equal(run.status, 81, `crash checkpoint ${stage}: ${run.stderr}`);
            const restart = spawnSync(process.execPath, [__filename, '--child', 'read', directory, 'none'], {encoding: 'utf8', timeout: 15000});
            assert.equal(restart.status, 0, `restart ${stage}: ${restart.stderr}`);
            const observed = JSON.parse(restart.stdout);
            const expected = first && stage === 'temp-partial' ? {blocked: true}
                : {value: stage === 'committed' || first ? 'candidate' : 'last-good'};
            assert.deepEqual(observed, expected, `restart at ${stage}, first=${first}`);
            results.push({stage, firstWrite: first, ...observed});
        } finally { await fsp.rm(directory, {recursive: true, force: true}); }
    }
    process.stdout.write(`${JSON.stringify({hostProcessCrashCases: results.length, results}, null, 2)}\n`);
}

const [, , command, mode, directory, stage] = process.argv;
(command === '--child' ? child(mode, directory, stage) : parent()).catch(error => { console.error(error); process.exitCode = 1; });

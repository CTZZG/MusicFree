import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const fixture = {exports: {}};
vm.runInNewContext(readFileSync('e2e/plugins/e2e-source-a.js', 'utf8'), {
    module: fixture, setTimeout,
});
const {search, getLyric} = fixture.exports;
const ref = 'a'.repeat(40);
assert.equal((await search(`e2e ${ref}`, 1, 'music')).data.length, 7);
const songs = (await search(`e2e boundaries ${ref}`, 1, 'music')).data;
assert.equal(songs.length, 3);
const parsed = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('src/utils/lrcParser.ts', 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText, {
    exports: parsed.exports, require: () => ({devLog() {}}),
});
const raw = await getLyric(songs[1]);
const lines = new parsed.exports.default(raw.rawLrc).getLyricItems();
assert.equal(lines.length, 30);
for (let i = 0; i < lines.length; i++) {
    assert.equal(lines[i].hasWordByWord, true);
    assert.equal(lines[i].words[0].text, i % 2 ? '啊' : 'Stay');
    assert.equal(lines[i].words[0].duration, 2400);
}
const wide = new parsed.exports.default((await getLyric(songs[0])).rawLrc).getLyricItems();
assert.equal(wide[0].lrc, 'W'.repeat(26));
assert.equal(wide[1].lrc, '汉字'.repeat(14));
assert.equal(wide[2].lrc, '👩‍🎤'.repeat(5));
console.log('Boundary fixture: unchanged normal queue, 30 actual parser long-note lines and four share inputs passed');

const cardModule = {exports: {}};
vm.runInNewContext(ts.transpileModule(readFileSync('src/components/musicShare/cardLayout.ts', 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS},
}).outputText, {exports: cardModule.exports});
const layout = cardModule.exports.getShareCardLayout(songs[0].title, 'E2E Artist',
    wide.map((line, index) => ({index, text: line.lrc})), false);
assert.equal(layout.height, 961);
assert.equal(layout.text.map(row => row.y).join(','), '294,359,452,517,610,703,768');

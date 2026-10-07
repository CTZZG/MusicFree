// src/test/java 也编进模拟器测试 APK，名字里有空格或 ASCII 标点时 D8 报错。
// 第一版检查只认 fun 后面紧跟反引号的写法：扩展函数、泛型函数漏掉了，注释里的
// 示例反而报错（复核用 Kotlin 1.9.24 编过，扩展和泛型写法的 class 文件里确实是
// 带空格的方法名）。这些用例锁住这几种情况。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    backtickNames,
    dexUnsafeBacktickNames,
    isDexSafeName,
} from './dexNames.mjs';

const kotlin = body => `package \`fun\`.upup.musicfree\n\n${body}\n`;
const unsafe = source => dexUnsafeBacktickNames(source).map(({name}) => name);

test('rejects a spaced name in every kind of declaration', () => {
    for (const declaration of [
        'fun `bad name`() {}',
        'fun String.`bad name`() {}',
        'fun <T> `bad name`() {}',
        'fun <T : Comparable<T>> List<T>.`bad name`(): T? = null',
        'fun String?.`bad name`() {}',
        'fun ((Int) -> Unit).`bad name`() {}',
        'suspend fun `fun`.upup.Foo.`bad name`() {}',
        '@Test\n    fun\n    `bad name`() {}',
        'val String.`bad name`: Int get() = 1',
        'val <T> List<T>.`bad name`: Int get() = size',
        'class `bad name`',
        'object `bad name`',
    ]) {
        assert.deepEqual(unsafe(kotlin(declaration)), ['bad name'], declaration);
    }
});

test('rejects ASCII punctuation and spaces that old DEX versions refuse', () => {
    for (const name of [
        "track's retries",
        'a,b',
        'x(y)',
        'done!',
        'a\u00a0b', // 不换行空格：DEX 040 才允许
        'a\u2007b', // 数字空格：DEX 040 才允许
        'a\u200bb', // 零宽空格：任何版本都不允许
    ]) {
        assert.equal(isDexSafeName(name), false, JSON.stringify(name));
        assert.deepEqual(unsafe(kotlin(`fun \`${name}\`() {}`)), [name]);
    }
});

test('accepts names DEX allows', () => {
    for (const name of [
        'aSeekMadeWhileTheFileLoads',
        '换音质接着原来的进度播',
        'kebab-case_name$1',
        'when',
        'fun',
        '𝒜', // 补充平面的字符
    ]) {
        assert.equal(isDexSafeName(name), true, name);
    }
    const source = kotlin(
        [
            'import `fun`.upup.musicfree.mpvplayer.PendingSeek',
            'fun `换音质接着原来的进度播`() {}',
            'fun aSeekMadeWhileTheFileLoads() { `when`(mock).thenReturn(1) }',
        ].join('\n'),
    );
    assert.deepEqual(unsafe(source), []);
    assert.deepEqual(
        backtickNames(source).map(({name}) => name),
        ['fun', 'fun', '换音质接着原来的进度播', 'when'],
    );
});

test('ignores names in comments, strings and char literals', () => {
    for (const body of [
        '// fun `bad name`() {}',
        '/* fun `bad name`() {} */',
        '/* outer /* inner */ fun `bad name`() {} */',
        '/**\n * 例如 fun `bad name`()\n */',
        'val text = "fun `bad name`() {}"',
        'val text = "escaped \\" fun `bad name`()"',
        'val text = """\n    fun `bad name`() "quoted" \n"""',
        "val tick = '`'",
        "val tick = '\\u0060'",
    ]) {
        assert.deepEqual(unsafe(kotlin(body)), [], body);
    }
});

test('what looks like a comment or string boundary does not hide later code', () => {
    for (const body of [
        'val url = "http://example.test/a"\nfun `bad name`() {}',
        'val quote = \'"\'\nfun `bad name`() {}',
        "val apostrophe = \"it's\"\nfun `bad name`() {}",
        'val raw = """a""""\nfun `bad name`() {}',
        'val dollar = """${\'$\'}{x}"""\nfun `bad name`() {}',
        'val tick = \'`\'\nfun `bad name`() {}',
    ]) {
        assert.deepEqual(unsafe(kotlin(body)), ['bad name'], body);
    }
});

test('checks the code inside string templates', () => {
    assert.deepEqual(unsafe(kotlin('val text = "${`bad name`()}"')), [
        'bad name',
    ]);
    // 模板里的字符串、大括号和注释都不会让模板提前结束
    const source = kotlin(
        [
            'val text = "${listOf("}").map { "`not code`" /* } */ }}"',
            'fun `bad name`() {}',
        ].join('\n'),
    );
    assert.deepEqual(dexUnsafeBacktickNames(source), [
        {name: 'bad name', line: 4},
    ]);
});

test('reports the line of each name', () => {
    const source = [
        'package `fun`.upup.musicfree',
        '/*',
        ' * fun `in comment`()',
        ' */',
        'val text = """',
        'fun `in string`()',
        '"""',
        'fun `first one`() {}',
        '',
        'fun String.`second one`() {}',
    ].join('\n');
    assert.deepEqual(dexUnsafeBacktickNames(source), [
        {name: 'first one', line: 8},
        {name: 'second one', line: 10},
    ]);
});

test('unterminated input ends without throwing', () => {
    for (const source of [
        'val text = "abc',
        'val text = """abc',
        '/* abc',
        'fun `abc',
        "val c = '",
        'val text = "${',
    ]) {
        assert.deepEqual(unsafe(source), [], source);
    }
});

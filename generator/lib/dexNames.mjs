/**
 * build.gradle 把 src/test/java 也编进模拟器测试 APK（androidTest）。安装下限
 * API 24 对应的 DEX（040 之前的版本）不允许名字里有空格和大部分 ASCII 标点：
 * 反引号句子名 fun `a b`() 在 JVM 单元测试里照常能跑，编测试 APK 时 D8 才报错。
 *
 * 这里不去解析 Kotlin 声明（扩展函数、泛型、属性、类的写法太多，漏一种就漏报），
 * 而是跳过注释、字符串和字符字面量，检查代码里出现的每一个反引号名字：声明和
 * 引用都算，测试代码没有理由用编不进 DEX 的名字。字符串模板 ${…} 里是代码，
 * 照样检查。
 */

// DEX 040 之前允许的名字字符（dex-format 的 SimpleNameChar）。补充平面的字符
// 在 UTF-16 里是一对代理项，落在 ‰-￯ 之内，照样放行。
const DEX_UNSAFE_CHAR = /[^A-Za-z0-9_$\-\u00a1-\u1fff\u2010-\u2027\u2030-\uffef]/;

/** @param {string} name */
export function isDexSafeName(name) {
    return name.length > 0 && !DEX_UNSAFE_CHAR.test(name);
}

/**
 * 代码里（不含注释、字符串和字符字面量）出现的反引号名字及其行号。
 * @param {string} source Kotlin 源码
 * @returns {{name: string, line: number}[]}
 */
export function backtickNames(source) {
    const names = [];
    // 当前所在的位置：代码、普通字符串、三引号字符串。字符串模板 ${…} 里的
    // 代码另记大括号层数，回到 0 时遇到的 } 结束模板、回到字符串里
    const stack = [{kind: 'code', template: false, braces: 0}];
    let line = 1;
    let i = 0;
    const skip = count => {
        const end = Math.min(i + count, source.length);
        for (; i < end; i++) {
            if (source[i] === '\n') line++;
        }
    };
    const enterTemplate = () => {
        stack.push({kind: 'code', template: true, braces: 0});
        skip(2);
    };

    while (i < source.length) {
        const context = stack[stack.length - 1];
        const char = source[i];
        const next = source[i + 1];

        if (context.kind === 'string') {
            if (char === '\\') {
                skip(2);
            } else if (char === '"' || char === '\n') {
                stack.pop();
                skip(1);
            } else if (char === '$' && next === '{') {
                enterTemplate();
            } else {
                skip(1);
            }
            continue;
        }

        if (context.kind === 'raw') {
            if (source.startsWith('"""', i)) {
                // 结尾的引号可以多于三个，多出来的属于字符串内容
                while (source[i] === '"') skip(1);
                stack.pop();
            } else if (char === '$' && next === '{') {
                enterTemplate();
            } else {
                skip(1);
            }
            continue;
        }

        if (char === '/' && next === '/') {
            const end = source.indexOf('\n', i);
            skip((end === -1 ? source.length : end) - i);
        } else if (char === '/' && next === '*') {
            // Kotlin 的块注释可以嵌套
            let depth = 0;
            do {
                if (source.startsWith('/*', i)) {
                    depth++;
                    skip(2);
                } else if (source.startsWith('*/', i)) {
                    depth--;
                    skip(2);
                } else {
                    skip(1);
                }
            } while (depth > 0 && i < source.length);
        } else if (source.startsWith('"""', i)) {
            stack.push({kind: 'raw'});
            skip(3);
        } else if (char === '"') {
            stack.push({kind: 'string'});
            skip(1);
        } else if (char === "'") {
            // 字符字面量：'a'、'\''、'`'，也可能就是一个反引号 '`'
            skip(1);
            if (source[i] === '\\') skip(source[i + 1] === 'u' ? 6 : 2);
            else skip(1);
            if (source[i] === "'") skip(1);
        } else if (char === '`') {
            const end = source.indexOf('`', i + 1);
            const lineEnd = source.indexOf('\n', i + 1);
            if (end === -1 || (lineEnd !== -1 && lineEnd < end)) {
                skip(1);
            } else {
                names.push({name: source.slice(i + 1, end), line});
                skip(end + 1 - i);
            }
        } else if (char === '{') {
            context.braces++;
            skip(1);
        } else if (char === '}') {
            if (context.template && context.braces === 0) stack.pop();
            else context.braces--;
            skip(1);
        } else {
            skip(1);
        }
    }
    return names;
}

/**
 * 编不进 DEX 的反引号名字。
 * @param {string} source Kotlin 源码
 */
export function dexUnsafeBacktickNames(source) {
    return backtickNames(source).filter(({name}) => !isDexSafeName(name));
}

/**
 * 解释 `npm view <spec> version --json` 的结果，返回版本号数组。
 *
 * 只有两种情况算「没有版本」：命令成功但没有输出，或者 npm 明确回答这个范围里
 * 没有匹配的版本（E404「No match found for version」）。其余失败一律抛错：断网、
 * registry 出错、包本身 404、进程被杀或超时，都不能当成「上游没有修复版」，
 * 否则生产依赖审计的例外会被悄悄放行。
 *
 * @param {string} spec 例如 `braces@>3.0.3 ^3.0.2`
 * @param {{status: number | null, signal?: string | null, stdout?: string, stderr?: string}} result
 * @returns {string[]}
 */
export function parseNpmViewVersions(spec, result) {
    const stdout = String(result.stdout ?? '').trim();

    if (result.status === 0) {
        if (!stdout) {
            return [];
        }
        const parsed = parseJsonOrThrow(spec, stdout);
        if (parsed && typeof parsed === 'object' && parsed.error) {
            throw new Error(describeFailure(spec, result, parsed.error));
        }
        return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
    }

    let error;
    try {
        error = stdout ? JSON.parse(stdout)?.error : undefined;
    } catch {
        error = undefined;
    }
    if (
        error?.code === 'E404' &&
        /^No match found for version/i.test(String(error.summary ?? ''))
    ) {
        return [];
    }
    throw new Error(describeFailure(spec, result, error));
}

function parseJsonOrThrow(spec, text) {
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            `npm view ${spec} did not return JSON:\n${text.slice(0, 2000)}`,
        );
    }
}

function describeFailure(spec, result, error) {
    const exit =
        result.status === null || result.status === undefined
            ? `signal ${result.signal ?? 'unknown'}`
            : `exit ${result.status}`;
    const detail =
        error?.summary ??
        (String(result.stderr ?? '').trim().slice(0, 500) || 'no output');
    return `npm view ${spec} failed (${exit}${error?.code ? `, ${error.code}` : ''}): ${detail}`;
}

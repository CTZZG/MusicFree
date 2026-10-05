/**
 * ESLint 警告的棘轮：每条规则的警告数只许减少，不许增加。
 *
 * 基线（generator/eslint-warning-baseline.json）记着每条规则现有多少条警告。
 * 检查时按规则比较：
 * - 某条规则比基线多了，就是新加了警告，失败。按规则而不是按总数比，
 *   修掉一条 A 规则的警告不能抵消新加的一条 B 规则的警告；
 * - 某条规则比基线少了，也失败，提示运行 `npm run lint:baseline` 把基线降下来：
 *   不降的话，空出来的名额以后会被新警告悄悄用掉；
 * - 不在基线里的规则，一条警告也不许有。
 *
 * 收紧基线只会降低或删掉条目，不会提高，也不会加入新规则。确实要提高
 * （例如升级 ESLint 配置后多出一批警告）时手改 JSON，在提交里写明原因。
 * 报错（severity 2）不进基线，有报错就失败。
 */

/** 没有规则名的警告（例如多余的 eslint-disable 注释）记在这个键下 */
export const NO_RULE = '(no rule)';

function sortedEntries(record) {
    return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function sortKeys(record) {
    return Object.fromEntries(sortedEntries(record));
}

/**
 * @param {Array<{messages: Array<{ruleId: string | null, severity: number}>}>} results
 *   ESLint 的 lintFiles 结果
 * @returns {Record<string, number>} 每条规则的警告数
 */
export function countWarningsByRule(results) {
    const counts = {};
    for (const result of results) {
        for (const message of result.messages) {
            if (message.severity !== 1) {
                continue;
            }
            const rule = message.ruleId ?? NO_RULE;
            counts[rule] = (counts[rule] ?? 0) + 1;
        }
    }
    return sortKeys(counts);
}

/**
 * 读基线：规则名 → 非负整数。格式不对直接报错，免得一个写错的值让检查形同虚设。
 * @param {unknown} json
 * @returns {Record<string, number>}
 */
export function parseBaseline(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error('ESLint baseline must be an object of rule → warning count');
    }
    for (const [rule, count] of Object.entries(json)) {
        if (!Number.isInteger(count) || count < 0) {
            throw new Error(
                `ESLint baseline for "${rule}" must be a non-negative integer, got ${JSON.stringify(count)}`,
            );
        }
    }
    return sortKeys(json);
}

/**
 * @param {Record<string, number>} counts 本次每条规则的警告数
 * @param {Record<string, number>} baseline
 * @returns {{
 *   regressions: Array<{rule: string, baseline: number, actual: number}>,
 *   improvements: Array<{rule: string, baseline: number, actual: number}>,
 * }}
 */
export function compareWithBaseline(counts, baseline) {
    const rules = [...new Set([...Object.keys(counts), ...Object.keys(baseline)])].sort();
    const regressions = [];
    const improvements = [];
    for (const rule of rules) {
        const actual = counts[rule] ?? 0;
        const allowed = baseline[rule] ?? 0;
        if (actual > allowed) {
            regressions.push({rule, baseline: allowed, actual});
        } else if (actual < allowed) {
            improvements.push({rule, baseline: allowed, actual});
        }
    }
    return {regressions, improvements};
}

/**
 * 收紧基线：每条规则取基线和实际的较小值，降到 0 的删掉。
 * 不会提高任何一条，也不会加入基线里没有的规则。
 */
export function tightenBaseline(counts, baseline) {
    const next = {};
    for (const [rule, allowed] of Object.entries(baseline)) {
        const value = Math.min(allowed, counts[rule] ?? 0);
        if (value > 0) {
            next[rule] = value;
        }
    }
    return sortKeys(next);
}

/**
 * 检查结论。errorCount 是 ESLint 报错的条数。
 * @returns {{ok: boolean, lines: string[]}} 失败原因和处理办法，逐行
 */
export function evaluate({errorCount, counts, baseline}) {
    const {regressions, improvements} = compareWithBaseline(counts, baseline);
    const lines = [];
    if (errorCount > 0) {
        lines.push(`ESLint reported ${errorCount} error(s); fix them first.`);
    }
    if (regressions.length) {
        lines.push('More warnings than the baseline allows (fix the new ones; the baseline only goes down):');
        for (const {rule, baseline: allowed, actual} of regressions) {
            lines.push(`  ${rule}: ${actual} (baseline ${allowed})`);
        }
    }
    if (improvements.length) {
        lines.push(
            'Fewer warnings than the baseline: run `npm run lint:baseline` and commit generator/eslint-warning-baseline.json',
        );
        for (const {rule, baseline: allowed, actual} of improvements) {
            lines.push(`  ${rule}: ${actual} (baseline ${allowed})`);
        }
    }
    return {ok: lines.length === 0, lines};
}

/** 每条规则一行：实际 / 基线，按规则名排序 */
export function summarize(counts, baseline) {
    const rules = [...new Set([...Object.keys(counts), ...Object.keys(baseline)])].sort();
    const width = Math.max(0, ...rules.map(rule => rule.length));
    return rules.map(
        rule => `  ${rule.padEnd(width)}  ${String(counts[rule] ?? 0).padStart(4)} / ${baseline[rule] ?? 0}`,
    );
}

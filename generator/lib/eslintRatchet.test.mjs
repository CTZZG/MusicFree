// ESLint 警告棘轮：多了要失败、少了要提示降基线、收紧时绝不提高。
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
    NO_RULE,
    compareWithBaseline,
    countWarningsByRule,
    evaluate,
    parseBaseline,
    tightenBaseline,
} from './eslintRatchet.mjs';

const warning = ruleId => ({ruleId, severity: 1});
const error = ruleId => ({ruleId, severity: 2});

test('counts warnings per rule; errors are not warnings', () => {
    assert.deepEqual(
        countWarningsByRule([
            {messages: [warning('quotes'), warning('quotes'), error('semi')]},
            {messages: [warning('no-void'), warning(null)]},
            {messages: []},
        ]),
        {[NO_RULE]: 1, 'no-void': 1, quotes: 2},
    );
});

test('passes when every rule is exactly at its baseline', () => {
    const baseline = {quotes: 2, 'no-void': 1};
    assert.deepEqual(evaluate({errorCount: 0, counts: {...baseline}, baseline}), {
        ok: true,
        lines: [],
    });
});

test('fails on any ESLint error, whatever the warnings', () => {
    const result = evaluate({errorCount: 1, counts: {}, baseline: {}});
    assert.equal(result.ok, false);
    assert.match(result.lines[0], /1 error/);
});

test('a new warning fails even if another rule improved by the same amount', () => {
    // 总数没变（3 → 3），但 no-void 多了一条
    const result = evaluate({
        errorCount: 0,
        counts: {quotes: 1, 'no-void': 2},
        baseline: {quotes: 2, 'no-void': 1},
    });
    assert.equal(result.ok, false);
    assert.ok(result.lines.some(line => /no-void: 2 \(baseline 1\)/.test(line)));
});

test('a rule that is not in the baseline allows no warnings at all', () => {
    assert.deepEqual(compareWithBaseline({eqeqeq: 1}, {quotes: 3}).regressions, [
        {rule: 'eqeqeq', baseline: 0, actual: 1},
    ]);
});

test('fewer warnings than the baseline fails and asks for the baseline to be lowered', () => {
    const result = evaluate({errorCount: 0, counts: {quotes: 1}, baseline: {quotes: 3}});
    assert.equal(result.ok, false);
    assert.ok(result.lines.some(line => /npm run lint:baseline/.test(line)));
    assert.ok(result.lines.some(line => /quotes: 1 \(baseline 3\)/.test(line)));
});

test('a rule fixed down to zero also counts as an improvement', () => {
    assert.deepEqual(compareWithBaseline({}, {radix: 1}).improvements, [
        {rule: 'radix', baseline: 1, actual: 0},
    ]);
});

test('tightening lowers to the current count, drops fixed rules and never raises or adds', () => {
    assert.deepEqual(
        tightenBaseline(
            // quotes 降了，no-void 升了，radix 修完了，eqeqeq 是新冒出来的
            {quotes: 1, 'no-void': 9, eqeqeq: 2},
            {quotes: 3, 'no-void': 4, radix: 1},
        ),
        {'no-void': 4, quotes: 1},
    );
});

test('after tightening, rules that grew still fail', () => {
    const counts = {quotes: 1, 'no-void': 9};
    const baseline = tightenBaseline(counts, {quotes: 3, 'no-void': 4});
    const result = evaluate({errorCount: 0, counts, baseline});
    assert.equal(result.ok, false);
    assert.ok(result.lines.some(line => /no-void: 9 \(baseline 4\)/.test(line)));
    assert.ok(!result.lines.some(line => /lint:baseline/.test(line)));
});

test('rejects a malformed baseline instead of silently allowing everything', () => {
    for (const bad of [null, [], 'quotes', {quotes: -1}, {quotes: 1.5}, {quotes: '3'}]) {
        assert.throws(() => parseBaseline(bad), /ESLint baseline/);
    }
    assert.deepEqual(parseBaseline({quotes: 2, eqeqeq: 0}), {eqeqeq: 0, quotes: 2});
});

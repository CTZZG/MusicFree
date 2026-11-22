const assert = require("node:assert/strict");
const {createProbeOwner} = require(process.argv[2] || "./ownership.js");

(async () => {
    const calls = [];
    const native = {
        loadAndPlay: value => { calls.push(value); return value; },
        destroy: async () => { calls.push("destroy"); },
    };
    const first = createProbeOwner(native);
    assert.equal(first.bridge.loadAndPlay("owned"), "owned");
    const waiting = first.until(() => false, "fixture missing", 15000).catch(error => error);
    const cleanup = first.dispose();
    const second = createProbeOwner(native);
    await cleanup;
    assert.deepEqual(calls, ["owned"], "old cleanup cannot destroy the new owner");
    assert.throws(() => first.bridge.loadAndPlay("late-old"), /superseded/);
    const cancelled = await Promise.race([waiting, new Promise(resolve => setTimeout(() => resolve("timeout"), 250))]);
    assert.equal(cancelled.code, "probe-owner-cancelled", "unmounted wait must stop before the15s deadline");
    assert.equal(second.bridge.loadAndPlay("new"), "new");
    await second.until(() => true, "never");
    await second.dispose();
    await second.dispose();
    assert.deepEqual(calls, ["owned", "new", "destroy"], "cleanup destroys only its own player once");
    assert.throws(() => second.bridge.loadAndPlay("after-dispose"), /superseded/);
    console.log("Actual probe ownership: late load, pending wait, old destroy and duplicate cleanup controls passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

import {
    ManualSkipOperationGate,
    MpvTrackTransitionGate,
    shouldIgnoreDuringTransition,
    waitForExpectedActive,
} from "../manualSkipCoordinator";

describe("manual skip coordinator", () => {
    it("serializes overlapping skip requests in click order", async () => {
        const gate = new ManualSkipOperationGate();
        let resolveFirst!: () => void;
        const firstOperation = jest.fn(
            () =>
                new Promise<void>(resolve => {
                    resolveFirst = resolve;
                }),
        );
        const secondOperation = jest.fn().mockResolvedValue(undefined);

        const first = gate.run(firstOperation);
        const second = gate.run(secondOperation);
        expect(second).not.toBe(first);
        expect(gate.pendingCount).toBe(2);
        await Promise.resolve();
        await Promise.resolve();
        expect(firstOperation).toHaveBeenCalledTimes(1);
        expect(secondOperation).not.toHaveBeenCalled();

        resolveFirst();
        await first;
        await second;
        expect(secondOperation).toHaveBeenCalledTimes(1);
        expect(gate.isPending).toBe(false);
    });

    it("continues the serialized queue after a failed operation", async () => {
        const gate = new ManualSkipOperationGate();
        const failure = new Error("skip failed");
        const secondOperation = jest.fn().mockResolvedValue(undefined);

        const first = gate.run(async () => {
            throw failure;
        });
        const second = gate.run(secondOperation);

        await expect(first).rejects.toBe(failure);
        await expect(second).resolves.toBeUndefined();
        expect(secondOperation).toHaveBeenCalledTimes(1);
        expect(gate.pendingCount).toBe(0);
    });

    it("preserves every repeated and mixed skip intent in order", async () => {
        const gate = new ManualSkipOperationGate();
        const order: string[] = [];
        let index = 0;
        const next = () =>
            gate.run(async () => {
                order.push("next");
                index += 1;
            });
        const previous = () =>
            gate.run(async () => {
                order.push("previous");
                index -= 1;
            });

        await Promise.all([next(), next(), previous(), next()]);

        expect(order).toEqual(["next", "next", "previous", "next"]);
        expect(index).toBe(2);
        expect(gate.pendingCount).toBe(0);
    });

    it("cancels queued intents without interrupting the running operation", async () => {
        const gate = new ManualSkipOperationGate();
        let resolveFirst!: () => void;
        const first = gate.run(
            () =>
                new Promise<void>(resolve => {
                    resolveFirst = resolve;
                }),
        );
        const queuedOperation = jest.fn().mockResolvedValue(undefined);
        const queued = gate.run(queuedOperation);

        await Promise.resolve();
        await Promise.resolve();
        gate.cancelPending();
        resolveFirst();

        await first;
        await queued;
        expect(queuedOperation).not.toHaveBeenCalled();
        expect(gate.pendingCount).toBe(0);
    });

    it("runs a new intent after cancellation while skipping older queued work", async () => {
        const gate = new ManualSkipOperationGate();
        let resolveRunning!: () => void;
        let runningToken: Parameters<Parameters<typeof gate.run>[0]>[0] | null =
            null;
        const running = gate.run(
            token =>
                new Promise<void>(resolve => {
                    runningToken = token;
                    resolveRunning = resolve;
                }),
        );
        const staleOperation = jest.fn().mockResolvedValue(undefined);
        const stale = gate.run(staleOperation);

        await Promise.resolve();
        await Promise.resolve();
        gate.cancelPending();
        expect(gate.isActive(runningToken)).toBe(false);
        const latestOperation = jest.fn().mockResolvedValue(undefined);
        const latest = gate.run(latestOperation);
        resolveRunning();

        await Promise.all([running, stale, latest]);
        expect(staleOperation).not.toHaveBeenCalled();
        expect(latestOperation).toHaveBeenCalledTimes(1);
        expect(gate.pendingCount).toBe(0);
    });

    it("rejects stale active identities while an MPV transition is pending", () => {
        const gate = new MpvTrackTransitionGate();
        const transition = gate.begin("plugin::target");

        expect(gate.isActive(transition)).toBe(true);
        expect(gate.acceptsActiveKey("plugin::old")).toBe(false);
        expect(gate.acceptsActiveKey("plugin::target")).toBe(true);
        expect(gate.clear(transition)).toBe(true);
        expect(gate.acceptsActiveKey("plugin::old")).toBe(true);
    });

    it("does not let an older MPV transition clear a newer target", () => {
        const gate = new MpvTrackTransitionGate();
        const older = gate.begin("plugin::b");
        const newer = gate.begin("plugin::c");

        expect(gate.isActive(older)).toBe(false);
        expect(gate.clear(older)).toBe(false);
        expect(gate.isActive(newer)).toBe(true);
        expect(gate.acceptsActiveKey("plugin::b")).toBe(false);
        expect(gate.acceptsActiveKey("plugin::c")).toBe(true);
    });

    it("treats a repeated target as a newer MPV transition", () => {
        const gate = new MpvTrackTransitionGate();
        const older = gate.begin("plugin::same");
        const newer = gate.begin("plugin::same");

        expect(gate.isActive(older)).toBe(false);
        expect(gate.clear(older)).toBe(false);
        expect(gate.isActive(newer)).toBe(true);
        expect(gate.clear(newer)).toBe(true);
    });

    it("rejects a missing native identity while a target is pending", () => {
        const gate = new MpvTrackTransitionGate();
        const transition = gate.begin("plugin::target");

        expect(gate.acceptsActiveKey()).toBe(false);
        expect(gate.acceptsActiveKey(null)).toBe(false);
        expect(gate.clear(transition)).toBe(true);
    });

    it("waits through a stale active identity until the expected track is confirmed", async () => {
        const activeIds = ["a", "a", "b"];
        let clock = 0;
        const active = await waitForExpectedActive(
            async () => activeIds.shift() ?? "b",
            id => id === "b",
            {
                timeoutMs: 100,
                pollIntervalMs: 10,
                now: () => clock,
                sleep: async durationMs => {
                    clock += durationMs;
                },
            },
        );

        expect(active).toBe("b");
        expect(clock).toBe(20);
    });

    it("returns null when native activation never reaches the target", async () => {
        let clock = 0;
        const active = await waitForExpectedActive(
            async () => "a",
            id => id === "b",
            {
                timeoutMs: 25,
                pollIntervalMs: 10,
                now: () => clock,
                sleep: async durationMs => {
                    clock += durationMs;
                },
            },
        );

        expect(active).toBeNull();
        expect(clock).toBe(25);
    });

    it("stops waiting when the owning transition is cancelled", async () => {
        let clock = 0;
        let cancelled = false;
        const active = await waitForExpectedActive(
            async () => "a",
            id => id === "b",
            {
                timeoutMs: 100,
                pollIntervalMs: 10,
                now: () => clock,
                isCancelled: () => cancelled,
                sleep: async durationMs => {
                    clock += durationMs;
                    cancelled = true;
                },
            },
        );

        expect(active).toBeNull();
        expect(clock).toBe(10);
    });
});

describe("stale event filtering during a manual skip", () => {
    // 这条规则此前在 TrackPlayer 里为 trackChanged / playbackError /
    // active-track 同步各写了一遍，夹在 trace 调用中间，既看不清也测不到。
    it("passes everything through when no transition is active", () => {
        expect(shouldIgnoreDuringTransition({
            transitionActive: false,
            eventKey: "anything",
            expectedKey: "expected",
        })).toBe(false);
    });

    it("accepts the event that matches what the transition expects", () => {
        expect(shouldIgnoreDuringTransition({
            transitionActive: true,
            eventKey: "target",
            expectedKey: "target",
        })).toBe(false);
    });

    // 核心场景：点了下一首之后，mpv 还在为上一首发事件。把它们当真会把
    // 刚切过去的曲目又拽回旧的那首。
    it("drops late events that still refer to the previous track", () => {
        expect(shouldIgnoreDuringTransition({
            transitionActive: true,
            eventKey: "previous",
            expectedKey: "target",
        })).toBe(true);
    });

    it("drops events whose track cannot be identified", () => {
        expect(shouldIgnoreDuringTransition({
            transitionActive: true,
            eventKey: null,
            expectedKey: "target",
        })).toBe(true);
    });

    // 事务状态不完整时宁可放过：过滤掉一切会让播放彻底卡死，
    // 而放过最多是一次状态抖动。
    it("does not filter when the transition has no expected key", () => {
        expect(shouldIgnoreDuringTransition({
            transitionActive: true,
            eventKey: "whatever",
            expectedKey: null,
        })).toBe(false);
    });
});

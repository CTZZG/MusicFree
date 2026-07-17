import {
    ManualSkipOperationGate,
    waitForExpectedActive,
} from "../manualSkipCoordinator";

describe("manual skip coordinator", () => {
    it("deduplicates overlapping skip requests and releases after completion", async () => {
        const gate = new ManualSkipOperationGate();
        let resolveOperation!: () => void;
        const operation = jest.fn(
            () =>
                new Promise<void>(resolve => {
                    resolveOperation = resolve;
                }),
        );

        const first = gate.run(operation);
        const second = gate.run(operation);
        expect(second).toBe(first);
        await Promise.resolve();
        expect(operation).toHaveBeenCalledTimes(1);

        resolveOperation();
        await first;
        operation.mockResolvedValueOnce(undefined);
        await gate.run(operation);
        expect(operation).toHaveBeenCalledTimes(2);
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
});

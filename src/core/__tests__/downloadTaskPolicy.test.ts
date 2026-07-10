import {
    createDownloadAttemptIdentity,
    isSameDownloadAttempt,
    splitDownloadTaskRetention,
} from "../downloadTaskPolicy";

describe("download attempt identity", () => {
    it("does not let an old callback match an immediate redownload", () => {
        const firstAttempt = createDownloadAttemptIdentity(
            "plugin@track",
            () => "attempt-1",
        );
        const redownload = createDownloadAttemptIdentity(
            "plugin@track",
            () => "attempt-2",
        );

        expect(isSameDownloadAttempt(redownload, firstAttempt)).toBe(false);
        expect(isSameDownloadAttempt(redownload, redownload)).toBe(true);
    });

    it("also rejects an attempt belonging to another logical item", () => {
        expect(
            isSameDownloadAttempt(
                { logicalKey: "plugin@other", attemptId: "attempt-1" },
                { logicalKey: "plugin@track", attemptId: "attempt-1" },
            ),
        ).toBe(false);
    });
});

describe("download task retention", () => {
    it("caps terminal history without dropping active tasks", () => {
        const terminal = Array.from({ length: 240 }, (_, index) => ({
            id: `history-${index}`,
            terminal: true,
        }));
        const active = Array.from({ length: 8 }, (_, index) => ({
            id: `active-${index}`,
            terminal: false,
        }));

        const retained = splitDownloadTaskRetention(
            [...terminal.slice(0, 120), ...active, ...terminal.slice(120)],
            {
                maxTerminalHistory: 200,
                isTerminal: task => task.terminal,
            },
        );

        expect(retained.active).toEqual(active);
        expect(retained.terminal).toHaveLength(200);
        expect(retained.terminal[0].id).toBe("history-40");
        expect(retained.terminal.at(-1)?.id).toBe("history-239");
    });

    it("retains the most recently completed terminal tasks, not map insertion order", () => {
        const tasks = [
            {
                id: "queued-first-completed-last",
                terminal: true,
                completedAt: 300,
            },
            {
                id: "queued-second-completed-first",
                terminal: true,
                completedAt: 100,
            },
            { id: "active", terminal: false, completedAt: 0 },
            {
                id: "queued-third-completed-second",
                terminal: true,
                completedAt: 200,
            },
        ];

        expect(
            splitDownloadTaskRetention(tasks, {
                maxTerminalHistory: 2,
                isTerminal: task => task.terminal,
                getTerminalOrder: task => task.completedAt,
            }),
        ).toEqual({
            active: [tasks[2]],
            terminal: [tasks[3], tasks[0]],
        });
    });
    it("supports clearing terminal history while retaining active work", () => {
        const active = { id: "active", terminal: false };
        expect(
            splitDownloadTaskRetention([active, { id: "done", terminal: true }], {
                maxTerminalHistory: 0,
                isTerminal: task => task.terminal,
            }),
        ).toEqual({ active: [active], terminal: [] });
    });
});

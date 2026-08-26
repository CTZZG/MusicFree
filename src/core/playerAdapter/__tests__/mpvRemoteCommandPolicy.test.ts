import {
    isStaleMpvRemoteCommand,
    mpvRemoteCommandStaleThresholdMs,
} from "../mpvRemoteCommandPolicy";

const now = 1_000_000;

describe("isStaleMpvRemoteCommand", () => {
    it("drops compounding commands that queued up while JS was frozen", () => {
        expect(
            isStaleMpvRemoteCommand({
                command: "next",
                enqueuedAt: now - mpvRemoteCommandStaleThresholdMs - 1,
                now,
            }),
        ).toBe(true);
        expect(
            isStaleMpvRemoteCommand({
                command: "previous",
                enqueuedAt: now - 60000,
                now,
            }),
        ).toBe(true);
    });

    it("keeps freshly delivered commands", () => {
        expect(
            isStaleMpvRemoteCommand({
                command: "next",
                enqueuedAt: now - 40,
                now,
            }),
        ).toBe(false);
        expect(
            isStaleMpvRemoteCommand({
                command: "next",
                enqueuedAt: now - mpvRemoteCommandStaleThresholdMs,
                now,
            }),
        ).toBe(false);
    });

    it("never drops idempotent transport commands", () => {
        (["play", "pause", "stop", "duck"] as const).forEach(command => {
            expect(
                isStaleMpvRemoteCommand({
                    command,
                    enqueuedAt: now - 600000,
                    now,
                }),
            ).toBe(false);
        });
    });

    it("keeps commands without a usable timestamp", () => {
        expect(
            isStaleMpvRemoteCommand({ command: "next", now }),
        ).toBe(false);
        expect(
            isStaleMpvRemoteCommand({
                command: "next",
                enqueuedAt: Number.NaN,
                now,
            }),
        ).toBe(false);
        // 时钟回拨不应被当成过期
        expect(
            isStaleMpvRemoteCommand({
                command: "next",
                enqueuedAt: now + 60000,
                now,
            }),
        ).toBe(false);
    });
});

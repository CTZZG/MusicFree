import {
    clearPluginDiagnosticEvents,
    isRecentPluginDiagnosticEvent,
    recentPluginDiagnosticWindowMs,
    recordPluginDiagnosticMessage,
} from "../diagnostics";

const mockDiagnosticValues = new Map<string, string>();

jest.mock("@/utils/getOrCreateMMKV", () => ({
    __esModule: true,
    default: () => ({
        getString: (key: string) => mockDiagnosticValues.get(key),
        set: (key: string, value: string) => {
            mockDiagnosticValues.set(key, value);
        },
        delete: (key: string) => {
            mockDiagnosticValues.delete(key);
        },
    }),
}));

describe("plugin diagnostics sanitization", () => {
    beforeEach(() => {
        clearPluginDiagnosticEvents();
    });

    it("redacts URLs, credentials, headers, and local paths", () => {
        const event = recordPluginDiagnosticMessage({
            pluginName: "test",
            method: "capability",
            message: [
                "https://example.com/media/song.mp3?token=secret",
                "authorization: Bearer-secret",
                "file:///storage/emulated/0/private.mp3",
            ].join(" "),
        });

        expect(event.message).not.toContain("example.com");
        expect(event.message).not.toContain("secret");
        expect(event.message).not.toContain("private.mp3");
        expect(event.message).toContain("<remote-url>");
    });

    it("stores capability denials without request payload data", () => {
        const event = recordPluginDiagnosticMessage({
            pluginName: "test",
            pluginHash: "hash",
            method: "capability",
            message:
                "outcome=denied; capability=network.http; reason=url-policy",
        });

        expect(event).toMatchObject({
            pluginName: "test",
            pluginHash: "hash",
            method: "capability",
            message:
                "outcome=denied; capability=network.http; reason=url-policy",
        });
    });
    // Regression: events were only trimmed by count (20/plugin, 200 total), never
    // by age, and the plugin list showed the latest event per plugin. Every
    // failure since install therefore stayed visible forever -- including ones
    // already fixed -- which is why "every plugin has an error" was reported.
    describe("recency window", () => {
        const now = 1_700_000_000_000;

        it("keeps an event inside the window", () => {
            expect(isRecentPluginDiagnosticEvent(
                { createdAt: now - 1000 },
                now,
            )).toBe(true);
        });

        it("drops an event older than the window", () => {
            expect(isRecentPluginDiagnosticEvent(
                { createdAt: now - recentPluginDiagnosticWindowMs - 1 },
                now,
            )).toBe(false);
        });

        it("treats a future timestamp as recent rather than hiding it", () => {
            // A device whose clock moved backwards must not silently hide live
            // errors.
            expect(isRecentPluginDiagnosticEvent(
                { createdAt: now + 60_000 },
                now,
            )).toBe(true);
        });
    });
});

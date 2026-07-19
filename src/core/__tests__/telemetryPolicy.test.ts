import { isTelemetryOptedIn } from "../telemetryPolicy";

describe("isTelemetryOptedIn", () => {
    it("keeps telemetry disabled when the preference is absent", () => {
        expect(isTelemetryOptedIn(undefined)).toBe(false);
    });

    it("keeps telemetry disabled when the negative switch is enabled", () => {
        expect(isTelemetryOptedIn(true)).toBe(false);
    });

    it("allows telemetry only after an explicit opt-in", () => {
        expect(isTelemetryOptedIn(false)).toBe(true);
    });
});

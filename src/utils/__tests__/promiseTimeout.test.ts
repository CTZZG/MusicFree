import {
    isTimeoutError,
    TimeoutError,
    withTimeout,
} from "../promiseTimeout";

describe("withTimeout", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("returns the original value when the promise resolves before timeout", async () => {
        await expect(withTimeout(Promise.resolve("ok"), 1000)).resolves.toBe(
            "ok",
        );
    });

    it("rejects with TimeoutError when the promise does not settle in time", async () => {
        jest.useFakeTimers();
        const result = withTimeout(
            new Promise(() => undefined),
            1000,
            "搜索超时",
        );

        jest.advanceTimersByTime(1000);

        await expect(result).rejects.toMatchObject({
            name: "TimeoutError",
            message: "搜索超时",
        });
    });

    it("preserves non-timeout failures from the wrapped promise", async () => {
        const error = new Error("plugin failed");

        await expect(withTimeout(Promise.reject(error), 1000)).rejects.toBe(
            error,
        );
    });

    it("identifies timeout errors without matching unrelated errors", () => {
        expect(isTimeoutError(new TimeoutError())).toBe(true);
        expect(isTimeoutError(new Error("TimeoutError"))).toBe(false);
    });

    it("delegates timer scheduling and clearing to BackgroundTimer when available", async () => {
        const BackgroundTimer = require("react-native-background-timer").default;
        const origSet = BackgroundTimer.setTimeout;
        const origClear = BackgroundTimer.clearTimeout;
        const mockSet = jest.fn((fn: () => void) => setTimeout(fn, 0));
        const mockClear = jest.fn((id: any) => clearTimeout(id));
        BackgroundTimer.setTimeout = mockSet;
        BackgroundTimer.clearTimeout = mockClear;
        try {
            await expect(withTimeout(Promise.resolve("done"), 500)).resolves.toBe("done");
            expect(mockSet).toHaveBeenCalledTimes(1);
            expect(mockClear).toHaveBeenCalledTimes(1);
        } finally {
            BackgroundTimer.setTimeout = origSet;
            BackgroundTimer.clearTimeout = origClear;
        }
    });
});

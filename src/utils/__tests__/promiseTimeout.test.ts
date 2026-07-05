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
});

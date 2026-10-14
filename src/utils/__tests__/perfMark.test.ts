const mockNativePerfMark = jest.fn();
jest.mock("react-native", () => ({
    NativeModules: {
        NativeUtils: {
            perfMark: (...args: unknown[]) => mockNativePerfMark(...args),
        },
    },
}));

import { formatPerfDetail, perfMark, perfMarkOnce } from "../perfMark";

describe("perfMark", () => {
    beforeEach(() => {
        mockNativePerfMark.mockReset();
    });

    it("hands the name, the wall-clock time and a one-line detail to native", () => {
        const before = Date.now();
        perfMark("play-request", { key: "E2E 测试源 A@tone a", skip: false });
        const [name, atMs, detail] = mockNativePerfMark.mock.calls[0];
        expect(name).toBe("play-request");
        expect(atMs).toBeGreaterThanOrEqual(before);
        expect(atMs).toBeLessThanOrEqual(Date.now());
        expect(detail).toBe("key=E2E_测试源_A@tone_a skip=false");
    });

    it("drops empty values and never throws when native logging fails", () => {
        expect(formatPerfDetail({ a: 1, b: undefined, c: null })).toBe("a=1");
        expect(formatPerfDetail()).toBe("");
        mockNativePerfMark.mockImplementation(() => {
            throw new Error("bridge gone");
        });
        expect(() => perfMark("x")).not.toThrow();
    });

    it("marks a once-only point a single time per process", () => {
        perfMarkOnce("first-screen");
        perfMarkOnce("first-screen");
        expect(mockNativePerfMark).toHaveBeenCalledTimes(1);
    });
});

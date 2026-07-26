import createDelayedAction from "../delayedAction";

describe("createDelayedAction", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("replaces a pending invocation", () => {
        const callback = jest.fn();
        const action = createDelayedAction(callback, 200);

        action.schedule();
        jest.advanceTimersByTime(100);
        action.schedule();
        jest.advanceTimersByTime(199);
        expect(callback).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(callback).toHaveBeenCalledTimes(1);
    });

    it("does not invoke after cancellation", () => {
        const callback = jest.fn();
        const action = createDelayedAction(callback, 200);

        action.schedule();
        action.cancel();
        jest.runAllTimers();
        expect(callback).not.toHaveBeenCalled();
    });
});

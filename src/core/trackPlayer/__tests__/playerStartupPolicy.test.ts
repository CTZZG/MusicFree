import { shouldHydratePlayerHooks } from "../playerStartupPolicy";

describe("playerStartupPolicy", () => {
    it("blocks native state hydration until the configured backend is ready", () => {
        expect(shouldHydratePlayerHooks(false)).toBe(false);
        expect(shouldHydratePlayerHooks(true)).toBe(true);
    });

    it("does not resolve or query Nitro during an MPV cold start", () => {
        const resolveNitroAdapter = jest.fn();
        const getState = jest.fn();

        if (shouldHydratePlayerHooks(false)) {
            resolveNitroAdapter();
            getState();
        }

        expect(resolveNitroAdapter).not.toHaveBeenCalled();
        expect(getState).not.toHaveBeenCalled();
    });
});

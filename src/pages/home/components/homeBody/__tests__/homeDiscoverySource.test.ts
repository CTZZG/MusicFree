jest.mock("@/core/appConfig", () => ({ useAppConfig: jest.fn() }));
jest.mock("@/core/pluginManager", () => ({
    __esModule: true,
    default: { isPluginEnabled: jest.fn() },
    useSortedPlugins: jest.fn(),
}));

import { resolveHomeDiscoverySource } from "../useHomeDiscoverySource";

function plugin(name: string, methods: string[], enabled = true) {
    return { name, supportedMethods: new Set(methods), enabled };
}

const isEnabled = (item: { enabled: boolean }) => item.enabled;

describe("resolveHomeDiscoverySource", () => {
    const sorted = [
        plugin("lyrics-only", ["getLyric"]),
        plugin("A", ["getTopLists"]),
        plugin("B", ["getRecommendSheetsByTag", "getTopLists"]),
        plugin("C", ["getRecommendSheetsByTag"], false),
    ];

    it("offers only enabled plugins that can feed the home page", () => {
        const { candidates } = resolveHomeDiscoverySource(
            sorted,
            undefined,
            isEnabled,
        );
        expect(candidates.map(item => item.name)).toEqual(["A", "B"]);
    });

    it("keeps the plugin the user picked", () => {
        expect(
            resolveHomeDiscoverySource(sorted, "B", isEnabled).plugin?.name,
        ).toBe("B");
    });

    it("falls back to the first candidate when the pick is gone or disabled", () => {
        expect(
            resolveHomeDiscoverySource(sorted, "C", isEnabled).plugin?.name,
        ).toBe("A");
        expect(
            resolveHomeDiscoverySource(sorted, "removed", isEnabled).plugin
                ?.name,
        ).toBe("A");
    });

    it("returns no source when nothing can feed the home page", () => {
        expect(
            resolveHomeDiscoverySource([sorted[0]], undefined, isEnabled),
        ).toEqual({ plugin: null, candidates: [] });
    });
});

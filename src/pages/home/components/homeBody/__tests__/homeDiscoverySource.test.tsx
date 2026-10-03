jest.mock("@/core/appConfig", () => ({ useAppConfig: jest.fn() }));
jest.mock("@/core/pluginManager", () => ({
    __esModule: true,
    default: { isPluginEnabled: jest.fn() },
    useSortedPlugins: jest.fn(),
    // 用真实的启用状态信号，验证 hook 自己会跟着重算
    usePluginEnabledRevision: jest.requireActual(
        "@/core/pluginManager/enabledRevision",
    ).usePluginEnabledRevision,
}));

import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";
import { useAppConfig } from "@/core/appConfig";
import PluginManager, { useSortedPlugins } from "@/core/pluginManager";
import { notifyPluginEnabledChanged } from "@/core/pluginManager/enabledRevision";
import useHomeDiscoverySource, {
    resolveHomeDiscoverySource,
} from "../useHomeDiscoverySource";

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

/**
 * 回归背景：停用首页正在用的音源后，首页还继续用它。停用只发一个事件，插件列表
 * 本身不变，hook 只依赖列表，所以一直沿用停用前的结果。
 */
describe("useHomeDiscoverySource", () => {
    const enabled = new Map<string, boolean>();
    // 同一个数组对象：模拟停用时插件列表不变
    const sortedPlugins = [
        plugin("A", ["getTopLists"]),
        plugin("B", ["getRecommendSheetsByTag"]),
    ];
    let renderer: ReactTestRenderer | undefined;
    let current: ReturnType<typeof useHomeDiscoverySource> | undefined;

    function Probe() {
        current = useHomeDiscoverySource();
        return null;
    }

    beforeEach(() => {
        enabled.clear();
        (useSortedPlugins as jest.Mock).mockReturnValue(sortedPlugins);
        (useAppConfig as jest.Mock).mockReturnValue("B");
        (PluginManager.isPluginEnabled as jest.Mock).mockImplementation(
            (item: { name: string }) => enabled.get(item.name) ?? true,
        );
    });

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    it("falls back as soon as the selected source is disabled", () => {
        act(() => {
            renderer = create(<Probe />);
        });
        expect(current?.plugin?.name).toBe("B");

        enabled.set("B", false);
        act(() => {
            notifyPluginEnabledChanged();
        });

        expect(current?.plugin?.name).toBe("A");
    });
});

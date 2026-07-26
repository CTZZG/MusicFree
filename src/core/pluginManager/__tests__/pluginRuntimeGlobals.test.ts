import {
    createPluginRuntimeGlobalObject,
    createPluginRuntimeGlobalValues,
    pluginRuntimeGlobalParameterNames,
} from "../pluginRuntimeGlobals";

describe("plugin runtime globals", () => {
    it("shadows known raw network globals away from the host realm", () => {
        const values = createPluginRuntimeGlobalValues();
        // eslint-disable-next-line no-new-func
        const inspect = Function(
            ...pluginRuntimeGlobalParameterNames,
            `
                "use strict";
                return {
                    fetchType: typeof fetch,
                    xhrType: typeof XMLHttpRequest,
                    wsType: typeof WebSocket,
                    globalsMatch: globalThis === window &&
                        window === self &&
                        self === global,
                    globalFetchType: typeof globalThis.fetch,
                    constructorType: typeof globalThis.constructor,
                };
            `,
        );

        expect(inspect(...values)).toEqual({
            constructorType: "undefined",
            fetchType: "undefined",
            globalFetchType: "undefined",
            globalsMatch: true,
            wsType: "undefined",
            xhrType: "undefined",
        });
    });

    it("uses a null-prototype global object for known browser-like aliases", () => {
        const runtimeGlobal = createPluginRuntimeGlobalObject();

        expect(Object.getPrototypeOf(runtimeGlobal)).toBeNull();
        expect(runtimeGlobal.globalThis).toBe(runtimeGlobal);
        expect(runtimeGlobal.window).toBe(runtimeGlobal);
        expect(runtimeGlobal.self).toBe(runtimeGlobal);
        expect(runtimeGlobal.global).toBe(runtimeGlobal);
        expect(Object.isFrozen(runtimeGlobal)).toBe(true);
    });
});

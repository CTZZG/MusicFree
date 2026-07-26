import {
    createRuntimeGlobal,
    runScriptInRuntimeGlobal,
} from "../runtime";

jest.mock("react-native-url-polyfill", () => ({
    URL,
    URLSearchParams,
}));

jest.mock("react-native-device-info", () => ({
    __esModule: true,
    default: {
        getVersion: () => "0.0.0-test",
    },
}));

jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
}));

describe("LX runtime globals", () => {
    it("shadows known raw network globals from custom-source scripts", () => {
        const runtimeGlobal = createRuntimeGlobal({});

        runScriptInRuntimeGlobal(
            `
                globalThis.__probe = {
                    fetchType: typeof fetch,
                    xhrType: typeof XMLHttpRequest,
                    wsType: typeof WebSocket,
                    globalFetchType: typeof globalThis.fetch,
                    globalsMatch: globalThis === window &&
                        window === self &&
                        self === global,
                    constructorType: typeof globalThis.constructor,
                };
            `,
            runtimeGlobal,
        );

        expect(runtimeGlobal.__probe).toEqual({
            constructorType: "undefined",
            fetchType: "undefined",
            globalFetchType: "undefined",
            globalsMatch: true,
            wsType: "undefined",
            xhrType: "undefined",
        });
        expect(Object.getPrototypeOf(runtimeGlobal)).toBeNull();
    });
});

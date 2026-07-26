export const pluginRuntimeGlobalParameterNames = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "globalThis",
    "window",
    "self",
    "global",
] as const;

export function createPluginRuntimeGlobalObject() {
    const runtimeGlobal = Object.assign(Object.create(null), {
        fetch: undefined,
        XMLHttpRequest: undefined,
        WebSocket: undefined,
        constructor: undefined,
    });
    runtimeGlobal.globalThis = runtimeGlobal;
    runtimeGlobal.window = runtimeGlobal;
    runtimeGlobal.self = runtimeGlobal;
    runtimeGlobal.global = runtimeGlobal;
    return Object.freeze(runtimeGlobal);
}

export function createPluginRuntimeGlobalValues() {
    const runtimeGlobal = createPluginRuntimeGlobalObject();
    return [
        undefined,
        undefined,
        undefined,
        runtimeGlobal,
        runtimeGlobal,
        runtimeGlobal,
        runtimeGlobal,
    ] as const;
}

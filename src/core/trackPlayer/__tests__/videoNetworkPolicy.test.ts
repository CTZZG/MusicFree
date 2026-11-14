import { classifyVideoNetwork } from "../videoNetworkPolicy";

describe("video network classification", () => {
    test.each([
        ["wifi", true, true, false, "unmetered"],
        ["ethernet", true, true, false, "unmetered"],
        ["wifi", true, true, true, "metered"],
        ["cellular", true, true, false, "metered"],
        ["vpn", true, true, false, "metered"],
        ["none", true, true, false, "offline"],
        ["unknown", true, true, false, "offline"],
        ["wifi", false, true, false, "offline"],
        ["wifi", null, true, false, "offline"],
        ["wifi", true, false, false, "offline"],
        ["wifi", true, null, false, "unmetered"],
    ] as const)("%s connected=%s reachable=%s expensive=%s is %s", (type, isConnected, isInternetReachable, expensive, expected) => {
        expect(classifyVideoNetwork({ type, isConnected, isInternetReachable,
            details: { isConnectionExpensive: expensive } })).toBe(expected);
    });
});

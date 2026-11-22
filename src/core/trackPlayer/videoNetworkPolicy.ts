export type VideoNetworkClass = "offline" | "unmetered" | "metered";

interface NetworkReading {
    isConnected: boolean | null;
    isInternetReachable?: boolean | null;
    type: string;
    details?: { isConnectionExpensive?: boolean | null } | null;
}

/** Shared classification for video consent and the final player admission. */
export function classifyVideoNetwork(state: NetworkReading): VideoNetworkClass {
    if (!state.isConnected || state.isInternetReachable === false ||
        state.type === "unknown" || state.type === "none") {
        return "offline";
    }
    return (state.type === "wifi" || state.type === "ethernet") &&
        !state.details?.isConnectionExpensive ? "unmetered" : "metered";
}

/**
 * UI hooks must not touch a native adapter before bootstrap has selected,
 * configured and restored the requested playback backend.
 */
export function shouldHydratePlayerHooks(playerReady: boolean) {
    return playerReady;
}

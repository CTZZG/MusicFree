import {
    isInsecureMediaPlaybackAllowed,
    isMediaHttpAllowed,
    isPluginInsecureHttpAllowed,
} from "../mediaHttpCompatibilityPolicy";

function createConfig(
    enabled: boolean,
    pluginHttp = false,
) {
    return {
        getConfig(key: string) {
            if (key === "basic.allowInsecureMediaPlayback") {
                return enabled;
            }
            if (key === "basic.allowPluginInsecureHttp") {
                return pluginHttp;
            }
            return undefined;
        },
    } as any;
}

describe("media HTTP compatibility policy", () => {
    // 后端条件已随 Nitro 移除而消失（只剩 MPV 一个后端）；剩下的两个
    // 前置条件仍必须成立：Android 平台 + 用户显式开启。
    it("requires Android and explicit user opt-in", () => {
        expect(isInsecureMediaPlaybackAllowed(
            createConfig(true),
            "android",
        )).toBe(true);
        expect(isInsecureMediaPlaybackAllowed(
            createConfig(false),
            "android",
        )).toBe(false);
        expect(isInsecureMediaPlaybackAllowed(
            createConfig(true),
            "ios",
        )).toBe(false);
    });

    it("gates the plugin cleartext switch on nothing but the switch", () => {
        expect(isPluginInsecureHttpAllowed(
            createConfig(false, true),
        )).toBe(true);
        expect(isPluginInsecureHttpAllowed(
            createConfig(false, false),
        )).toBe(false);
    });

    // Regression: media URLs used to be gated on isInsecureMediaPlaybackAllowed
    // alone, which requires playerBackend === "mpv". On the default nitro-player
    // backend that is always false, so every plugin returning an http:// media URL
    // failed with "媒体链接仅允许使用 HTTPS" and the plugin management page filled
    // up with errors.
    describe("isMediaHttpAllowed", () => {
        it("allows media HTTP on the default backend once the plugin switch is on", () => {
            expect(isMediaHttpAllowed(
                createConfig(false, true),
                "android",
            )).toBe(true);
        });

        it("still honours the legacy MPV-only switch", () => {
            expect(isMediaHttpAllowed(
                createConfig(true, false),
                "android",
            )).toBe(true);
        });

        it("refuses when neither switch is on", () => {
            expect(isMediaHttpAllowed(
                createConfig(false, false),
                "android",
            )).toBe(false);
            expect(isMediaHttpAllowed(
                createConfig(false, false),
                "android",
            )).toBe(false);
        });

        it("applies the plugin switch on iOS, unlike the MPV-only switch", () => {
            // The MPV switch is Android-only because it depends on the MPV
            // loopback proxy. The plugin cleartext opt-in is a policy decision
            // and is not platform specific.
            expect(isMediaHttpAllowed(
                createConfig(true, false),
                "ios",
            )).toBe(false);
            expect(isMediaHttpAllowed(
                createConfig(false, true),
                "ios",
            )).toBe(true);
        });
    });
});

import { validateRemoteInstallUrl } from "../remoteInstallUrl";

describe("validateRemoteInstallUrl", () => {
    it.each([
        "http://example.com/plugin.js",
        "file:///tmp/plugin.js",
        "https://localhost/plugin.js",
        "https://sub.localhost/plugin.js",
        "https://127.0.0.1/plugin.js",
        "https://10.0.0.1/plugin.js",
        "https://172.16.0.1/plugin.js",
        "https://172.31.255.255/plugin.js",
        "https://192.168.1.1/plugin.js",
        "https://169.254.1.1/plugin.js",
        "https://[::1]/plugin.js",
        "https://[fd00::1]/plugin.js",
        "https://[::ffff:127.0.0.1]/plugin.js",
        "https://user:password@example.com/plugin.js",
    ])("rejects unsafe remote install URL %s", url => {
        expect(validateRemoteInstallUrl(url).ok).toBe(false);
    });

    it("accepts and normalizes a public HTTPS URL", () => {
        expect(validateRemoteInstallUrl(" https://example.com/plugin.js ")).toEqual({
            ok: true,
            url: "https://example.com/plugin.js",
            hostname: "example.com",
        });
    });

    it("does not classify public addresses in the 172 block as private", () => {
        expect(validateRemoteInstallUrl("https://172.15.0.1/plugin.js").ok).toBe(true);
        expect(validateRemoteInstallUrl("https://172.32.0.1/plugin.js").ok).toBe(true);
    });
});

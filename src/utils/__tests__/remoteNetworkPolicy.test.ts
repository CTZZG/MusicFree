import { isBlockedRemoteHostname, validateRemoteNetworkUrl } from "../remoteNetworkPolicy";

describe("remoteNetworkPolicy IPv6 SSRF guards", () => {
    it("blocks NAT64 well-known private IPv4 and local-use prefixes while allowing NAT64 public IPv4", () => {
        expect(isBlockedRemoteHostname("64:ff9b::127.0.0.1")).toBe(true);
        expect(isBlockedRemoteHostname("64:ff9b::192.168.1.1")).toBe(true);
        expect(isBlockedRemoteHostname("64:ff9b:1::1")).toBe(true);
        expect(isBlockedRemoteHostname("64:ff9b::93.184.216.34")).toBe(false);

        expect(validateRemoteNetworkUrl("https://[64:ff9b::10.0.0.1]/a.mp3").ok).toBe(false);
        expect(validateRemoteNetworkUrl("https://[64:ff9b::93.184.216.34]/a.mp3").ok).toBe(true);
    });

    it("blocks 6to4 private IPv4 embeddings and 0100::/64 discard prefix", () => {
        expect(isBlockedRemoteHostname("2002:c0a8:0101::1")).toBe(true);
        expect(isBlockedRemoteHostname("2002:7f00:0001::1")).toBe(true);
        expect(isBlockedRemoteHostname("2002:5db8:d822::1")).toBe(false);

        expect(isBlockedRemoteHostname("0100::1")).toBe(true);
        expect(isBlockedRemoteHostname("0100:0:0:0:1::1")).toBe(true);
        expect(isBlockedRemoteHostname("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
    });
});

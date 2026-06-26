import { Buffer } from "buffer";
import {
    parseRsaPublicKey,
    pemToDer,
    pkcs1v15Pad,
} from "@/core/lxSource/rsa";

describe("parseRsaPublicKey", () => {
    it("parses a hand-built PKCS#1 RSAPublicKey DER", () => {
        // SEQUENCE { INTEGER 0x00C92B (leading 0x00 = positive), INTEGER 0x010001 }
        const der = Buffer.from([
            0x30, 0x0a,
            0x02, 0x03, 0x00, 0xc9, 0x2b,
            0x02, 0x03, 0x01, 0x00, 0x01,
        ]);
        const { n, e } = parseRsaPublicKey(der);
        expect(n.toString("hex")).toBe("c92b");
        expect(e.toString("hex")).toBe("010001");
    });
});

describe("pemToDer", () => {
    it("decodes a PEM body and strips headers/whitespace", () => {
        const der = Buffer.from([0x30, 0x05, 0x02, 0x03, 0x01, 0x00, 0x01]);
        const base64 = der.toString("base64");
        const pem = `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----`;
        expect(pemToDer(pem).equals(der)).toBe(true);
    });

    it("wraps a raw base64 key (no PEM header) before decoding", () => {
        const der = Buffer.from([0x30, 0x05, 0x02, 0x03, 0x01, 0x00, 0x01]);
        expect(pemToDer(der.toString("base64")).equals(der)).toBe(true);
    });
});

describe("pkcs1v15Pad", () => {
    it("produces a correctly structured padded block", () => {
        const message = Buffer.from("hi");
        const k = 16;
        const padded = pkcs1v15Pad(message, k);

        expect(padded).toHaveLength(k);
        expect(padded[0]).toBe(0x00);
        expect(padded[1]).toBe(0x02);
        // 0x00 separator right before the message
        const separatorIndex = k - message.length - 1;
        expect(padded[separatorIndex]).toBe(0x00);
        // padding string bytes are all non-zero
        for (let i = 2; i < separatorIndex; i++) {
            expect(padded[i]).not.toBe(0x00);
        }
        // message preserved at the tail
        expect(padded.subarray(k - message.length).toString()).toBe("hi");
    });

    it("throws when the message is too long for the key size", () => {
        expect(() => pkcs1v15Pad(Buffer.alloc(10), 16)).toThrow();
    });
});

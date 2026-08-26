import CryptoJs from "crypto-js";

import { buildApiSignature, buildSignatureBaseString } from "../signature";

describe("buildSignatureBaseString", () => {
    it("按参数名排序后拼成 名值名值", () => {
        expect(
            buildSignatureBaseString({
                method: "auth.getSession",
                api_key: "KEY",
                token: "TOKEN",
            }),
        ).toBe("api_keyKEYmethodauth.getSessiontokenTOKEN");
    });

    it("format / callback / api_sig 不参与签名", () => {
        expect(
            buildSignatureBaseString({
                api_key: "KEY",
                format: "json",
                callback: "cb",
                api_sig: "旧签名",
            }),
        ).toBe("api_keyKEY");
    });

    it("undefined 的参数被跳过，不会拼出 'keyundefined'", () => {
        expect(
            buildSignatureBaseString({
                api_key: "KEY",
                album: undefined,
            }),
        ).toBe("api_keyKEY");
    });

    it("带下标的批量键按字节序排，和服务端算法一致", () => {
        // 关键点：'[' (0x5B) 排在字母之后，所以 artist[0] 在 artist 之后、
        // 在 track 之前；用本地化排序会得到不同结果，签名就会对不上。
        const base = buildSignatureBaseString({
            "track[10]": "T10",
            "track[2]": "T2",
            "artist[0]": "A0",
        });
        expect(base).toBe("artist[0]A0track[10]T10track[2]T2");
    });

    it("数字参数按十进制字符串参与拼接", () => {
        expect(
            buildSignatureBaseString({
                duration: 200,
                api_key: "KEY",
            }),
        ).toBe("api_keyKEYduration200");
    });
});

describe("buildApiSignature", () => {
    it("是「基串 + secret」的 MD5 小写十六进制", () => {
        const params = {
            method: "track.scrobble",
            api_key: "KEY",
            sk: "SESSION",
        };
        const expected = CryptoJs.MD5(
            `${buildSignatureBaseString(params)}SECRET`,
        ).toString(CryptoJs.enc.Hex);

        const signature = buildApiSignature(params, "SECRET");
        expect(signature).toBe(expected);
        expect(signature).toMatch(/^[0-9a-f]{32}$/);
    });

    it("secret 不同则签名不同", () => {
        const params = { api_key: "KEY", method: "auth.getToken" };
        expect(buildApiSignature(params, "A")).not.toBe(
            buildApiSignature(params, "B"),
        );
    });

    it("参数书写顺序不影响签名", () => {
        expect(
            buildApiSignature({ b: "2", a: "1" }, "S"),
        ).toBe(buildApiSignature({ a: "1", b: "2" }, "S"));
    });
});

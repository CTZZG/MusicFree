import { Buffer } from "buffer";
import iconvLite from "iconv-lite";
import { PluginTextDecoder, PluginTextEncoder } from "../pluginTextCodec";

describe("plugin text codec shims", () => {
    it("decodes GB-family labels with iconv-lite", () => {
        const text = "酷我歌词";
        const bytes = iconvLite.encode(text, "gb18030");

        for (const label of ["gb18030", "GBK", "gb_2312", "cp936"]) {
            expect(new PluginTextDecoder(label).decode(bytes)).toBe(text);
        }
    });

    it("respects ArrayBufferView byte offsets when decoding plugin data", () => {
        const wrapped = Buffer.concat([
            Buffer.from([0xff, 0xff]),
            iconvLite.encode("中文", "gb18030"),
            Buffer.from([0x00, 0x00]),
        ]);
        const view = new Uint8Array(
            wrapped.buffer,
            wrapped.byteOffset + 2,
            wrapped.length - 4,
        );

        expect(new PluginTextDecoder("gbk").decode(view)).toBe("中文");
    });

    it("encodes utf-8 text and supports encodeInto fallback-compatible contract", () => {
        const encoder = new PluginTextEncoder();
        const destination = new Uint8Array(16);
        const result = encoder.encodeInto("hi", destination);

        expect(encoder.encoding.toLowerCase()).toBe("utf-8");
        expect(Array.from(encoder.encode("hi"))).toEqual([104, 105]);
        expect(result).toEqual({ read: 2, written: 2 });
        expect(Array.from(destination.slice(0, result.written))).toEqual([
            104,
            105,
        ]);
    });
});

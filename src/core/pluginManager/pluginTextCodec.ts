import { Buffer } from "buffer";
import iconvLite from "iconv-lite";

const nativeTextDecoder = globalThis.TextDecoder;
const nativeTextEncoder = globalThis.TextEncoder;
const gbEncodingLabels = new Set(["gb18030", "gbk", "gb2312", "cp936"]);
const warnedUtf8FallbackLabels = new Set<string>();

function normalizeEncodingLabel(label: string) {
    return label.toLowerCase().replace(/[-_\s]/g, "");
}

function warnUtf8Fallback(encoding: string) {
    if (typeof console === "undefined" || !console.warn) {
        return;
    }
    console.warn(
        "[PluginTextDecoder] TextDecoder unavailable; falling back to UTF-8",
        { encoding },
    );
}

function bufferFromTextDecoderInput(
    input?: ArrayBuffer | ArrayBufferView | null,
) {
    if (!input) {
        return Buffer.alloc(0);
    }
    if (input instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(input));
    }
    return Buffer.from(
        input.buffer as ArrayBuffer,
        input.byteOffset,
        input.byteLength,
    );
}

export class PluginTextDecoder {
    private decoder?: any;
    private encoding: string;
    private fatal: boolean;

    constructor(label: string = "utf-8", options?: any) {
        this.encoding = normalizeEncodingLabel(label);
        this.fatal = !!options?.fatal;

        if (!gbEncodingLabels.has(this.encoding)) {
            this.decoder = nativeTextDecoder
                ? new nativeTextDecoder(label, options)
                : undefined;
        }
    }

    decode(input?: ArrayBuffer | ArrayBufferView | null) {
        if (this.decoder) {
            return this.decoder.decode(input as any);
        }

        const buffer = bufferFromTextDecoderInput(input);
        if (gbEncodingLabels.has(this.encoding)) {
            try {
                return iconvLite.decode(buffer, "gb18030");
            } catch (error) {
                if (this.fatal) {
                    throw error;
                }
            }
        }

        if (
            this.encoding !== "utf8" &&
            !warnedUtf8FallbackLabels.has(this.encoding)
        ) {
            warnedUtf8FallbackLabels.add(this.encoding);
            warnUtf8Fallback(this.encoding);
        }
        return buffer.toString("utf8");
    }
}

export class PluginTextEncoder {
    private encoder?: any;

    constructor() {
        this.encoder = nativeTextEncoder ? new nativeTextEncoder() : undefined;
    }

    get encoding() {
        return this.encoder?.encoding ?? "utf-8";
    }

    encode(input: string = "") {
        if (this.encoder) {
            return this.encoder.encode(input);
        }
        const buffer = Buffer.from(String(input), "utf8");
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    encodeInto(source: string = "", destination: Uint8Array) {
        if (this.encoder?.encodeInto) {
            return this.encoder.encodeInto(source, destination);
        }

        let read = 0;
        let written = 0;
        for (let index = 0; index < source.length; ) {
            const codePoint = source.codePointAt(index);
            if (codePoint == null) {
                break;
            }
            const chunk = String.fromCodePoint(codePoint);
            const encoded = this.encode(chunk);
            if (written + encoded.length > destination.length) {
                break;
            }
            destination.set(encoded, written);
            written += encoded.length;
            index += chunk.length;
            read += chunk.length;
        }
        return { read, written };
    }
}

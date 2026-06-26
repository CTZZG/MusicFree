import { Buffer } from "buffer";
import bigInt from "big-integer";

/**
 * 自实现的 RSA 公钥加密（PKCS#1 v1.5 / block type 2），用于 LX 自定义源的
 * lx.utils.crypto.rsaEncrypt。React Native 没有 node crypto，这里用 big-integer
 * 做模幂，并自带一个最小 DER 解析器来提取公钥的 (n, e)。
 *
 * 语义对齐 lx-music 桌面端的 crypto.publicEncrypt({ padding: RSA_PKCS1_PADDING })：
 * - 输入：待加密数据 Buffer + 公钥（PEM，或裸 base64，会自动补 SPKI 头）
 * - 输出：加密后的 Buffer（长度等于模数字节数）
 * - 单块加密，数据超长（> k-11）时抛错（与 node 一致；分段由脚本自行处理）
 */

interface IDerTlv {
    tag: number;
    value: Buffer;
    end: number;
}

function readTlv(buf: Buffer, offset: number): IDerTlv {
    const tag = buf[offset];
    let pos = offset + 1;
    let length = buf[pos++];
    if (length & 0x80) {
        const numBytes = length & 0x7f;
        length = 0;
        for (let i = 0; i < numBytes; i++) {
            length = (length << 8) | buf[pos++];
        }
    }
    return {
        tag,
        value: buf.subarray(pos, pos + length),
        end: pos + length,
    };
}

function stripLeadingZeros(buf: Buffer): Buffer {
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0) {
        i++;
    }
    return buf.subarray(i);
}

function parseIntegers(seqContent: Buffer): { n: Buffer; e: Buffer } {
    const nTlv = readTlv(seqContent, 0);
    const eTlv = readTlv(seqContent, nTlv.end);
    return {
        n: stripLeadingZeros(Buffer.from(nTlv.value)),
        e: stripLeadingZeros(Buffer.from(eTlv.value)),
    };
}

/** 解析公钥 DER，支持 SPKI(SubjectPublicKeyInfo) 与裸 PKCS#1(RSAPublicKey) 两种结构 */
export function parseRsaPublicKey(der: Buffer): { n: Buffer; e: Buffer } {
    const outer = readTlv(der, 0); // SEQUENCE
    const first = readTlv(outer.value, 0);

    if (first.tag === 0x02) {
        // PKCS#1: outer SEQUENCE = { INTEGER n, INTEGER e }
        return parseIntegers(outer.value);
    }
    if (first.tag === 0x30) {
        // SPKI: outer = { SEQUENCE algorithm, BIT STRING subjectPublicKey }
        const bitString = readTlv(outer.value, first.end);
        // BIT STRING 第一个字节是 unused-bits 计数（0），其后才是 PKCS#1 DER
        const pkcs1Der = bitString.value.subarray(1);
        const seq = readTlv(pkcs1Der, 0); // SEQUENCE { n, e }
        return parseIntegers(seq.value);
    }
    throw new Error("Unsupported RSA public key structure");
}

export function pemToDer(key: string): Buffer {
    let pem = String(key ?? "").trim();
    if (!pem.includes("BEGIN")) {
        pem = `-----BEGIN PUBLIC KEY-----\n${pem}\n-----END PUBLIC KEY-----`;
    }
    const base64 = pem
        .replace(/-----BEGIN [^-]+-----/g, "")
        .replace(/-----END [^-]+-----/g, "")
        .replace(/\s+/g, "");
    return Buffer.from(base64, "base64");
}

/** PKCS#1 v1.5 type-2 填充：0x00 || 0x02 || PS(非零随机) || 0x00 || M */
export function pkcs1v15Pad(message: Buffer, k: number): Buffer {
    if (message.length > k - 11) {
        throw new Error("RSA message too long for key size");
    }
    const psLen = k - message.length - 3;
    const ps = Buffer.alloc(psLen);
    for (let i = 0; i < psLen; i++) {
        let byte = 0;
        while (byte === 0) {
            byte = Math.floor(Math.random() * 256);
        }
        ps[i] = byte;
    }
    return Buffer.concat([
        Buffer.from([0x00, 0x02]),
        ps,
        Buffer.from([0x00]),
        message,
    ]);
}

function bufferToBigInt(buf: Buffer) {
    return bigInt(buf.length ? buf.toString("hex") : "0", 16);
}

function bigIntToBuffer(value: bigInt.BigInteger, length: number): Buffer {
    let hex = value.toString(16);
    if (hex.length % 2) {
        hex = `0${hex}`;
    }
    let buf = Buffer.from(hex, "hex");
    if (buf.length < length) {
        buf = Buffer.concat([Buffer.alloc(length - buf.length), buf]);
    }
    return buf;
}

export function rsaEncrypt(data: Buffer, key: string): Buffer {
    const { n, e } = parseRsaPublicKey(pemToDer(key));
    const k = n.length;
    const em = pkcs1v15Pad(data, k);
    const cipher = bufferToBigInt(em).modPow(bufferToBigInt(e), bufferToBigInt(n));
    return bigIntToBuffer(cipher, k);
}

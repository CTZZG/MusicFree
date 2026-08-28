import {
    createPluginCapabilityContext,
    detectPluginCapabilities,
    type PluginCapabilityAuditEvent,
} from "../capabilityFirewall";
import bigInt from "big-integer";
import { Buffer } from "buffer";
import * as cheerio from "cheerio";
import CryptoJs from "crypto-js";
import dayjs from "dayjs";
import he from "he";
import iconvLite from "iconv-lite";
import * as pako from "pako";
import qs from "qs";

class MemoryStore {
    values = new Map<string, string>();
    getAllKeys = () => [...this.values.keys()];
    getString = (key: string) => this.values.get(key);
    set = (key: string, value: string) => this.values.set(key, value);
    delete = (key: string) => {
        this.values.delete(key);
    };
}

function createContext(
    overrides: Partial<Parameters<typeof createPluginCapabilityContext>[0]> = {},
) {
    return createPluginCapabilityContext({
        provisionalIdentity: "source",
        grantedCapabilities: [],
        safePackages: {
            safe: {
                version: 1,
                nested: {
                    mode: "safe",
                    entries: [{ value: 1 }],
                },
            },
            callable: Object.assign((value: number) => value + 1, {
                version: 1,
            }),
        },
        storageStore: new MemoryStore(),
        webdavModule: {
            AuthType: { Password: "password" },
            getPatcher: () => ({
                patch: jest.fn(),
            }),
            createClient: () => ({
                exists: async () => true,
                customRequest: async () => "unsafe",
            }),
        },
        ...overrides,
    });
}

describe("plugin capability firewall", () => {
    // axios 已不再是受管能力：受限 HTTP 客户端（强制 HTTPS、超时/体积/并发
    // 上限）让大量上游可用的插件直接失效，而插件的价值就在兼容性。传输层的
    // SSRF 防护下移到原生 PublicHttpsNetworkPolicy 的 Dns 过滤器。
    it("detects only literal high-risk module requests", () => {
        expect(detectPluginCapabilities(`
            const axios = require("axios");
            const storage = __musicfree_require('musicfree/storage');
            const safe = require("cheerio");
        `)).toEqual(["storage.plugin"]);
    });

    // 与上游官方一致：未知模块返回 null 而不是抛异常。插件里
    // `require("x") || fallback` 是常见写法，抛异常会让整个挂载崩掉。
    it("returns null for unknown modules instead of throwing", () => {
        const context = createContext();

        expect(context.require("fs")).toBeNull();
        expect(context.require("react-native")).toBeNull();
        expect(context.require("storage")).toBeNull();
    });

    it("requires explicit grants for webdav and storage capabilities", () => {
        const events: PluginCapabilityAuditEvent[] = [];
        const context = createContext({ onAudit: event => events.push(event) });

        expect(() => context.require("webdav")).toThrow("not approved");
        expect(() => context.require("musicfree/storage")).toThrow(
            "not approved",
        );
        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                capability: "network.webdav",
                outcome: "denied",
            }),
            expect.objectContaining({
                capability: "storage.plugin",
                outcome: "denied",
            }),
        ]));
    });

    /**
     * 只读代理（Proxy + deepFreeze）已停用，模块原样交给插件。
     *
     * 它拦不住真正的威胁——插件本来就能用
     * `[].constructor.constructor('return globalThis')()` 拿到真实全局——却
     * 持续制造兼容性事故：crypto-js 的 AES/DES 曾因它报
     * "Cannot read properties of undefined (reading 'call')"。上游官方同样
     * 直接给真实对象。
     */
    it("hands real module objects to plugins with CJS interop", () => {
        const context = createContext();
        const safe = context.require("safe") as any;

        // default 自引用：插件常写 require("x").default，与上游一致地补上。
        expect(safe.default).toBe(safe);
        // 可调用模块保持可调用。
        const callable = context.require("callable") as any;
        expect(callable(1)).toBe(2);
    });

    it("keeps class semantics intact for module exports", () => {
        class Constructable {
            static metadata = { mode: "safe" };

            constructor(public readonly value: number) {}

            read() {
                return this.value;
            }
        }
        const context = createContext({
            safePackages: { constructable: Constructable },
        });
        const Exported = context.require("constructable") as any;
        const instance = new Exported(7);

        // 构造、原型方法、instanceof 都必须照常工作——正是这些在只读代理下
        // 会以各种隐晦方式失效。
        expect(instance.read()).toBe(7);
        expect(instance).toBeInstanceOf(Constructable);
        expect(Exported.metadata).toEqual({ mode: "safe" });
    });

    it("keeps every supported production package operational", () => {
        const context = createContext({
            safePackages: {
                cheerio,
                "crypto-js": CryptoJs,
                dayjs,
                "big-integer": bigInt,
                qs,
                he,
                pako,
                buffer: { Buffer },
                "iconv-lite": iconvLite,
            },
        });

        const cheerioFacade = context.require("cheerio") as any;
        expect(cheerioFacade.load("<p>ok</p>")("p").text()).toBe("ok");

        const cryptoFacade = context.require("crypto-js") as any;
        expect(cryptoFacade.SHA256("MusicFree").toString()).toBe(
            CryptoJs.SHA256("MusicFree").toString(),
        );

        const dayjsFacade = context.require("dayjs") as any;
        expect(dayjsFacade("2026-07-25").format("YYYY-MM-DD"))
            .toBe("2026-07-25");

        const bigIntFacade = context.require("big-integer") as any;
        expect(bigIntFacade(2).pow(8).toString()).toBe("256");

        const qsFacade = context.require("qs") as any;
        expect(qsFacade.stringify({ page: 2, tags: ["a", "b"] }))
            .toBe("page=2&tags%5B0%5D=a&tags%5B1%5D=b");

        const heFacade = context.require("he") as any;
        expect(heFacade.decode("MusicFree &amp; plugins"))
            .toBe("MusicFree & plugins");

        const pakoFacade = context.require("pako") as any;
        const compressed = pakoFacade.deflate("MusicFree");
        expect(pakoFacade.inflate(compressed, { to: "string" }))
            .toBe("MusicFree");

        const bufferFacade = context.require("buffer") as any;
        expect(bufferFacade.Buffer.from("MusicFree").toString("utf8"))
            .toBe("MusicFree");

        const iconvFacade = context.require("iconv-lite") as any;
        expect(iconvFacade.decode(iconvFacade.encode("音乐", "gbk"), "gbk"))
            .toBe("音乐");
    });

    it("keeps crypto-js block ciphers working through the facade", () => {
        // Regression: the facade used to rebuild every object on
        // Object.prototype and copy own keys only. crypto-js reaches most of
        // its cipher API through prototypal inheritance -- `mode.ECB` inherits
        // `createEncryptor` from `BlockCipherMode` -- so AES/DES died with
        // "Cannot read properties of undefined (reading 'call')" while the
        // hash helpers above kept working and hid the breakage.
        const context = createContext({
            safePackages: { "crypto-js": CryptoJs },
        });
        const facade = context.require("crypto-js") as any;
        const passphrase = "0123456789abcdef";

        const parsedKey = facade.enc.Utf8.parse(passphrase);
        const encrypted = facade.AES
            .encrypt("MusicFree", parsedKey, { mode: facade.mode.ECB })
            .toString();

        expect(encrypted).toBe(
            CryptoJs.AES.encrypt(
                "MusicFree",
                CryptoJs.enc.Utf8.parse(passphrase),
                { mode: CryptoJs.mode.ECB },
            ).toString(),
        );
        expect(
            facade.AES
                .decrypt(encrypted, parsedKey, { mode: facade.mode.ECB })
                .toString(facade.enc.Utf8),
        ).toBe("MusicFree");

        // CBC with an explicit IV is the other shape plugins rely on.
        const iv = facade.enc.Utf8.parse("fedcba9876543210");
        const cbc = facade.AES.encrypt("MusicFree", parsedKey, { iv }).toString();
        expect(
            facade.AES.decrypt(cbc, parsedKey, { iv }).toString(facade.enc.Utf8),
        ).toBe("MusicFree");

        expect(facade.HmacSHA256("message", "key").toString())
            .toBe(CryptoJs.HmacSHA256("message", "key").toString());
        expect(facade.enc.Base64.stringify(parsedKey))
            .toBe(CryptoJs.enc.Base64.stringify(parsedKey));

        // 不再断言冻结：只读代理已停用（它正是当初让 AES/DES 挂掉的原因）。
        // 这个用例保留的价值在于「密码学 API 必须真的能用」——那才是插件
        // 依赖的东西，也是最容易被沙箱悄悄弄坏的部分。
        expect(CryptoJs.AES).not.toBeNull();
    });

    // WebDAV 仍走受限门面：它涉及用户自己的服务器凭据，且插件对它的需求
    // 远比 HTTP 少，收紧的兼容性代价小得多。customRequest 这类逃逸口必须
    // 挡住，否则受限门面形同虚设。
    it("never exposes a raw WebDAV client", async () => {
        const context = createContext({
            grantedCapabilities: ["network.webdav"],
        });
        const webdav = context.require("webdav") as any;

        const client = webdav.createClient("https://example.com");
        expect(client).not.toHaveProperty("customRequest");
        await expect(client.exists("/music")).resolves.toBe(true);
    });

    /**
     * axios 现在是普通 safePackage（生产代码在 plugin.ts 里注入真实模块），
     * 不再是需要审批的受管能力、也不再被受限客户端替换。
     *
     * 这条断言的意义：一旦有人把 axios 重新加回 capabilityByModule，
     * require 就会因未授权而抛异常，这里会失败并指回这个决定。
     */
    it("treats axios as an ordinary module, not a gated capability", () => {
        const realAxios = { interceptors: {}, get: () => undefined };
        const context = createContext({
            safePackages: { axios: realAxios },
        });

        // 没有任何 grantedCapabilities，却应当直接拿到模块本身。
        expect(context.require("axios")).toBe(realAxios);
    });
});

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
    it("detects only literal high-risk module requests", () => {
        expect(detectPluginCapabilities(`
            const axios = require("axios");
            const storage = __musicfree_require('musicfree/storage');
            const safe = require("cheerio");
        `)).toEqual(["network.http", "storage.plugin"]);
    });

    it("throws for unknown modules rather than returning null", () => {
        const context = createContext();

        expect(() => context.require("fs")).toThrow(
            "module \"fs\" is not available",
        );
        expect(() => context.require("react-native")).toThrow();
        expect(() => context.require("storage")).toThrow();
    });

    it("requires explicit grants for network and storage capabilities", () => {
        const events: PluginCapabilityAuditEvent[] = [];
        const context = createContext({ onAudit: event => events.push(event) });

        expect(() => context.require("axios")).toThrow("not approved");
        expect(() => context.require("webdav")).toThrow("not approved");
        expect(() => context.require("musicfree/storage")).toThrow(
            "not approved",
        );
        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({
                capability: "network.http",
                outcome: "denied",
            }),
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

    it("returns isolated immutable facades for safe packages", () => {
        const first = createContext();
        const second = createContext();
        const firstSafe = first.require("safe") as any;
        const secondSafe = second.require("safe") as any;

        expect(firstSafe.default).toBe(firstSafe);
        try {
            firstSafe.version = 2;
        } catch {}
        expect(firstSafe.version).toBe(1);
        expect(secondSafe.version).toBe(1);

        try {
            firstSafe.nested.mode = "mutated";
            firstSafe.nested.entries[0].value = 2;
            firstSafe.nested.entries.push({ value: 3 });
        } catch {}
        expect(firstSafe.nested).toEqual({
            mode: "safe",
            entries: [{ value: 1 }],
        });
        expect(secondSafe.nested).toEqual({
            mode: "safe",
            entries: [{ value: 1 }],
        });
        expect(Object.isFrozen(firstSafe.nested)).toBe(true);
        expect(Object.isFrozen(firstSafe.nested.entries)).toBe(true);
        expect(Object.isFrozen(firstSafe.nested.entries[0])).toBe(true);

        const callable = first.require("callable") as any;
        expect(callable(1)).toBe(2);
        expect(callable.default).toBe(callable);
    });

    it("preserves constructor, descriptor, and symbol semantics", () => {
        const symbolKey = Symbol("metadata");
        class Constructable {
            static metadata = { mode: "safe" };

            constructor(public readonly value: number) {}

            read() {
                return this.value;
            }
        }
        Object.defineProperty(Constructable, "hidden", {
            enumerable: false,
            value: { enabled: true },
        });
        Object.defineProperty(Constructable, symbolKey, {
            enumerable: false,
            value: { version: 1 },
        });
        const context = createContext({
            safePackages: { constructable: Constructable },
        });
        const Facade = context.require("constructable") as any;
        const instance = new Facade(7);

        expect(instance.read()).toBe(7);
        expect(instance).toBeInstanceOf(Facade);
        expect(Facade.hidden).toEqual({ enabled: true });
        expect(Facade[symbolKey]).toEqual({ version: 1 });
        expect(Object.getOwnPropertyDescriptor(Facade, "hidden")?.enumerable)
            .toBe(false);
        expect(Object.isFrozen(Facade.prototype)).toBe(true);
        expect(Object.isFrozen(Facade.metadata)).toBe(true);
        expect(Object.isFrozen(Facade.hidden)).toBe(true);
        expect(Object.isFrozen(Facade[symbolKey])).toBe(true);
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

        // The isolation property the facade exists for must still hold.
        expect(Object.isFrozen(facade)).toBe(true);
        expect(() => {
            "use strict";
            facade.AES = null;
        }).toThrow();
        expect(CryptoJs.AES).not.toBeNull();
    });

    it("never exposes a raw axios adapter or raw WebDAV client", async () => {
        const requester = jest.fn(async (
            _url: string,
            _config: unknown,
        ) => ({
            data: "ok",
            status: 200,
            statusText: "OK",
            headers: {},
            config: {},
            request: { responseURL: "https://example.com/data" },
        }) as any);
        const context = createContext({
            grantedCapabilities: ["network.http", "network.webdav"],
            httpOptions: { requester },
        });
        const axios = context.require("axios") as any;
        const webdav = context.require("webdav") as any;

        expect(axios).not.toHaveProperty("adapter");
        expect(axios.defaults).not.toHaveProperty("adapter");
        await expect(
            axios.get("https://example.com/data"),
        ).resolves.toMatchObject({ data: "ok" });

        const client = webdav.createClient("https://example.com");
        expect(client).not.toHaveProperty("customRequest");
        await expect(client.exists("/music")).resolves.toBe(true);
    });

    it("audits policy denials without including the attempted URL", async () => {
        const events: PluginCapabilityAuditEvent[] = [];
        const requester = jest.fn();
        const context = createContext({
            grantedCapabilities: ["network.http"],
            httpOptions: { requester },
            onAudit: event => events.push(event),
        });
        const axios = context.require("axios") as any;

        await expect(axios.get("https://127.0.0.1/private"))
            .rejects.toThrow();
        expect(requester).not.toHaveBeenCalled();
        expect(events.at(-1)).toEqual({
            capability: "network.http",
            moduleName: "axios",
            outcome: "denied",
            reason: "url-policy",
        });
        expect(JSON.stringify(events)).not.toContain("127.0.0.1");
    });
});

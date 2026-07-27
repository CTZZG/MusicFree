/**
 * 插件能力边界 —— **这不是安全沙箱，不要当成安全沙箱来维护。**
 *
 * 插件代码经 `Function(...)` 在应用自身的 JS realm 内执行，因此
 * `[].constructor.constructor("return globalThis")()` 一行即可取得真实
 * `globalThis`、真实 `fetch` 和 Metro 模块表。这个绕过在同一 realm 内**无法**
 * 修补：要堵住它必须屏蔽 `Function` 构造器，而 React Native 自身依赖它。
 * 真正的隔离需要独立 JS Runtime/进程 + 纯序列化 RPC（计划中的 G01），
 * 该项已于 2026-07-26 评估后明确不予实施。
 *
 * 那么这一层还有什么用（都不是防恶意代码）：
 * - **兼容与意外防护**：存储按插件命名空间隔离，避免不同插件互相踩键；
 *   未知模块 require 直接抛错而不是返回 null，让问题在安装时暴露。
 * - **可审计**：记录插件用了哪些能力、哪些被拒，便于定位插件故障。
 * - **良性插件的默认收敛**：网络默认公网 HTTPS，误配的私网地址不会被打到。
 *
 * 因此：不要为了「更安全」在这里加限制——那只会像 2026-07-26 那次一样打死
 * crypto-js AES、拦掉 11/12 个真实插件，而对恶意插件毫无约束。用户侧的真实
 * 保护是「只安装可信来源的插件」，能力审批弹窗现在如实这么说。
 */
import { createRestrictedHttpClient } from "@/utils/restrictedHttpClient";
import type { RestrictedHttpClientOptions } from "@/utils/restrictedHttpClient";
import {
    createPluginStorageFacade,
    type PluginStorageBackingStore,
} from "./pluginStorage";
import { createRestrictedWebdavFacade } from "./restrictedWebdav";
import type { IPluginCapability } from "@/types/core/pluginManager";

export const pluginCapabilities = [
    "network.http",
    "network.webdav",
    "storage.plugin",
] as const;

export type PluginCapability = IPluginCapability;

export interface PluginCapabilityAuditEvent {
    capability?: PluginCapability;
    moduleName?: string;
    outcome: "allowed" | "denied";
    reason: string;
}

interface PluginCapabilityContextOptions {
    provisionalIdentity: string;
    grantedCapabilities?: Iterable<PluginCapability>;
    safePackages: Record<string, unknown>;
    storageStore: PluginStorageBackingStore;
    webdavModule: {
        AuthType?: Record<string, unknown>;
        getPatcher?: () => {
            patch(
                key: string,
                method: (...args: any[]) => unknown,
            ): unknown;
        };
        createClient(
            remoteUrl: string,
            options?: Record<string, unknown>,
        ): any;
    };
    httpOptions?: RestrictedHttpClientOptions;
    onAudit?: (event: PluginCapabilityAuditEvent) => void;
}

const capabilityByModule: Record<string, PluginCapability | undefined> = {
    axios: "network.http",
    webdav: "network.webdav",
    "musicfree/storage": "storage.plugin",
};

export class PluginCapabilityError extends Error {
    constructor(
        message: string,
        public readonly capability?: PluginCapability,
        public readonly moduleName?: string,
    ) {
        super(message);
        this.name = "PluginCapabilityError";
    }
}

function createReadonlyPackageFacade(pkg: unknown): unknown {
    const wrappedValues = new WeakMap<object, any>();
    // Reverse of wrappedValues. When plugin code invokes a facade method the
    // receiver is the frozen wrapper; the underlying library must still see
    // its own real object, otherwise anything that mutates or walks `this`
    // (crypto-js ciphers, cheerio nodes) breaks.
    const realValues = new WeakMap<object, any>();

    const toReal = (receiver: unknown) => {
        if (
            receiver !== null &&
            (typeof receiver === "object" || typeof receiver === "function")
        ) {
            const real = realValues.get(receiver as object);
            if (real !== undefined) {
                return real;
            }
        }
        return receiver;
    };
    const skippedFunctionKeys = new Set<PropertyKey>([
        "length",
        "name",
        "arguments",
        "caller",
    ]);

    const isConstructable = (value: Function) => {
        try {
            Reflect.construct(String, [], value);
            return true;
        } catch {
            return false;
        }
    };

    const defineReadonlyProperties = (
        source: object,
        target: any,
        isRoot: boolean,
    ) => {
        Reflect.ownKeys(source).forEach(key => {
            if (
                (isRoot && key === "default") ||
                (
                    typeof source === "function" &&
                    skippedFunctionKeys.has(key)
                ) ||
                (Array.isArray(source) && key === "length")
            ) {
                return;
            }

            const descriptor = Object.getOwnPropertyDescriptor(source, key);
            if (!descriptor) {
                return;
            }

            if ("value" in descriptor) {
                const wrappedValue = wrap(descriptor.value, source);
                if (typeof source === "function" && key === "prototype") {
                    const targetDescriptor = Object.getOwnPropertyDescriptor(
                        target,
                        key,
                    );
                    if (targetDescriptor) {
                        Object.defineProperty(target, key, {
                            ...targetDescriptor,
                            value: wrappedValue,
                        });
                    }
                    return;
                }
                Object.defineProperty(target, key, {
                    configurable: true,
                    enumerable: descriptor.enumerable,
                    value: wrappedValue,
                    writable: true,
                });
                return;
            }

            Object.defineProperty(target, key, {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: descriptor.get
                    ? () => wrap(Reflect.apply(descriptor.get!, source, []), source)
                    : undefined,
            });
        });

        if (Array.isArray(source)) {
            target.length = source.length;
        }
        if (isRoot) {
            Object.defineProperty(target, "default", {
                configurable: true,
                enumerable: true,
                value: target,
                writable: true,
            });
        }
    };

    const wrap = (
        value: unknown,
        owner?: unknown,
        isRoot = false,
    ): unknown => {
        if (
            (typeof value !== "object" || value === null) &&
            typeof value !== "function"
        ) {
            return value;
        }

        const cached = wrappedValues.get(value as object);
        if (cached) {
            return cached;
        }

        if (typeof value === "function") {
            const constructable = isConstructable(value);
            const wrapped = constructable
                ? function readonlyPackageCallable(
                    this: unknown,
                    ...args: any[]
                ) {
                    if (new.target) {
                        const newTarget =
                            new.target === readonlyPackageCallable
                                ? value
                                : new.target;
                        return Reflect.construct(value, args, newTarget);
                    }
                    return Reflect.apply(
                        value,
                        this === undefined ? owner : toReal(this),
                        args,
                    );
                }
                : function readonlyPackageMethod(
                    this: unknown,
                    ...args: any[]
                ) {
                    return Reflect.apply(
                        value,
                        this === undefined ? owner : toReal(this),
                        args,
                    );
                };
            wrappedValues.set(value, wrapped);
            realValues.set(wrapped, value);
            defineReadonlyProperties(value, wrapped, isRoot);
            if (
                constructable &&
                !Object.prototype.hasOwnProperty.call(value, Symbol.hasInstance)
            ) {
                Object.defineProperty(wrapped, Symbol.hasInstance, {
                    configurable: true,
                    value: (candidate: unknown) =>
                        Function.prototype[Symbol.hasInstance].call(
                            value,
                            candidate,
                        ) ||
                        Function.prototype[Symbol.hasInstance].call(
                            wrapped,
                            candidate,
                        ),
                });
            }
            return Object.freeze(wrapped);
        }

        const wrapped: Record<string, unknown> | unknown[] =
            Array.isArray(value) ? [] : Object.create(null);
        wrappedValues.set(value, wrapped);
        realValues.set(wrapped, value);
        if (!Array.isArray(value)) {
            // Preserve the prototype chain. Libraries built on prototypal
            // inheritance expose most of their API through inherited members
            // (crypto-js `mode.ECB` inherits `createEncryptor` from
            // `BlockCipherMode`); flattening onto Object.prototype silently
            // deletes them and the call fails deep inside the library.
            const prototype = Object.getPrototypeOf(value);
            Object.setPrototypeOf(
                wrapped,
                prototype === null ||
                    prototype === Object.prototype ||
                    prototype === Function.prototype ||
                    prototype === Array.prototype
                    ? prototype
                    : (wrap(prototype) as object | null),
            );
        }
        defineReadonlyProperties(value, wrapped, isRoot);
        return Object.freeze(wrapped);
    };

    return wrap(pkg, undefined, true);
}

export function detectPluginCapabilities(source: string) {
    const detected = new Set<PluginCapability>();
    const literalRequire =
        /(?:\brequire|__musicfree_require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = literalRequire.exec(source)) !== null) {
        const capability = capabilityByModule[match[2]];
        if (capability) {
            detected.add(capability);
        }
    }
    return [...detected].sort();
}

export function createPluginCapabilityContext(
    options: PluginCapabilityContextOptions,
) {
    const granted = new Set(options.grantedCapabilities ?? []);
    const used = new Set<PluginCapability>();
    const allowedAuditRecorded = new Set<PluginCapability>();
    const safePackages = new Map(
        Object.entries(options.safePackages).map(([name, pkg]) => [
            name,
            createReadonlyPackageFacade(pkg),
        ]),
    );
    const storage = createPluginStorageFacade(
        options.storageStore,
        options.provisionalIdentity,
    );
    const audit = (event: PluginCapabilityAuditEvent) => {
        options.onAudit?.(event);
    };
    const recordAllowed = (capability: PluginCapability) => {
        used.add(capability);
        if (!allowedAuditRecorded.has(capability)) {
            allowedAuditRecorded.add(capability);
            audit({
                capability,
                outcome: "allowed",
                reason: "capability-used",
            });
        }
    };
    const requireCapability = (
        capability: PluginCapability,
        moduleName: string,
    ) => {
        if (!granted.has(capability)) {
            audit({
                capability,
                moduleName,
                outcome: "denied",
                reason: "capability-not-approved",
            });
            throw new PluginCapabilityError(
                `Plugin capability "${capability}" is not approved`,
                capability,
                moduleName,
            );
        }
        recordAllowed(capability);
    };

    const httpClient = createRestrictedHttpClient({
        ...options.httpOptions,
        onPolicyViolation(reason) {
            options.httpOptions?.onPolicyViolation?.(reason);
            audit({
                capability: "network.http",
                moduleName: "axios",
                outcome: "denied",
                reason,
            });
        },
    });
    const webdavFacade = createRestrictedWebdavFacade(
        options.webdavModule,
        {
            onPolicyViolation(reason) {
                audit({
                    capability: "network.webdav",
                    moduleName: "webdav",
                    outcome: "denied",
                    reason,
                });
            },
        },
    );

    const requireModule = (moduleName: string) => {
        if (typeof moduleName !== "string" || !moduleName) {
            audit({
                outcome: "denied",
                reason: "invalid-module-name",
            });
            throw new PluginCapabilityError(
                "Plugin module name must be a non-empty string",
            );
        }

        const capability = capabilityByModule[moduleName];
        if (capability) {
            requireCapability(capability, moduleName);
            if (moduleName === "axios") {
                return httpClient;
            }
            if (moduleName === "webdav") {
                return webdavFacade;
            }
            return storage.facade;
        }

        if (!safePackages.has(moduleName)) {
            audit({
                moduleName,
                outcome: "denied",
                reason: "module-not-available",
            });
            throw new PluginCapabilityError(
                `Plugin module "${moduleName}" is not available`,
                undefined,
                moduleName,
            );
        }
        return safePackages.get(moduleName);
    };

    return {
        require: requireModule,
        bindIdentity: storage.bindIdentity,
        getStorageMigrationReport: storage.getMigrationReport,
        getUsedCapabilities() {
            return [...used].sort();
        },
    };
}

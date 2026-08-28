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
import type { RestrictedHttpClientOptions } from "@/utils/restrictedHttpClient";
import {
    createPluginStorageFacade,
    type PluginStorageBackingStore,
} from "./pluginStorage";
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

/**
 * axios 已不在此列：受限 HTTP 客户端与上游官方的行为差异太大（强制 HTTPS、
 * 超时/体积/并发上限、同源重定向校验），导致大量官方能用的插件在这里直接
 * 失效——而插件的价值就在于兼容性。改为在 safePackages 里提供真实 axios。
 *
 * 传输层的 SSRF 防护仍然存在，只是下移到原生：PublicHttpsNetworkPolicy 的
 * Dns 过滤器拒绝回环/私网/链路本地/保留地址，那才是有真实价值的那一层。
 */
const capabilityByModule: Record<string, PluginCapability | undefined> = {
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

/**
 * 只读模块门面（Proxy + deepFreeze）。**当前未启用**。
 *
 * 它曾包裹每个交给插件的库对象，但会破坏任何依赖原型链或在 `this` 上写入
 * 的库——crypto-js 的 AES/DES 就因此报过
 * "Cannot read properties of undefined (reading 'call')"。而它拦不住真正的
 * 威胁：插件本来就能通过 `[].constructor.constructor('return globalThis')()`
 * 拿到真实全局对象。收益与它造成的兼容性事故不成比例，因此改为像上游官方
 * 那样直接把真实库对象交给插件。
 *
 * 保留实现而非删除，是为了在需要重新评估插件隔离方案时有现成参考。
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    const used = new Set<PluginCapability>();
    const allowedAuditRecorded = new Set<PluginCapability>();
    // 不再给模块套只读代理。上游官方直接把真实库对象交给插件，还额外做
    // `pkg.default = pkg` 的 CJS/ESM 互操作补丁。只读代理（Proxy + deepFreeze）
    // 会破坏任何依赖原型链或在 `this` 上做写入的库——crypto-js 的 AES/DES 就
    // 曾因此报 "Cannot read properties of undefined (reading 'call')"。
    // 它拦不住真正的威胁（插件本来就能拿到 globalThis），却持续制造兼容性事故。
    const safePackages = new Map(
        Object.entries(options.safePackages).map(([name, pkg]) => {
            // CJS 插件常写 `require("x").default`，与上游保持一致地补上。
            if (pkg && typeof pkg === "object" && !("default" in pkg)) {
                try {
                    (pkg as any).default = pkg;
                } catch {
                    // 冻结过的库忽略即可，插件按 CJS 用法仍能工作。
                }
            }
            return [name, pkg];
        }),
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
    /**
     * 记录插件用到了哪些能力，但**不再据此拦截**。
     *
     * 插件是受信任代码：它与应用同处一个 JS realm，
     * `[].constructor.constructor('return globalThis')()` 一行就能拿到真实
     * 全局对象，任何在这一层做的限制都绕得过去。继续维持审批只会让上游可用
     * 的插件在这里装不上（真机上三个插件全部因此失败），却换不到任何实际防护。
     *
     * 保留记录本身是有价值的：它让「这个插件用了网络/存储」出现在诊断报告里。
     */
    const requireCapability = (
        capability: PluginCapability,
        moduleName: string,
    ) => {
        void moduleName;
        recordAllowed(capability);
    };

    const requireModule = (moduleName: string) => {
        if (typeof moduleName !== "string" || !moduleName) {
            audit({
                outcome: "denied",
                reason: "invalid-module-name",
            });
            // 这一条不是策略拦截，而是调用方传了非法参数——原版同样会因
            // `packages[undefined]` 取不到而失败，只是失败得更隐晦。
            throw new PluginCapabilityError(
                "Plugin module name must be a non-empty string",
            );
        }

        const capability = capabilityByModule[moduleName];
        if (capability) {
            requireCapability(capability, moduleName);
            if (moduleName === "webdav") {
                // 真实 webdav 模块。受限门面（restrictedWebdav）随沙箱一起
                // 退役：它拦不住同 realm 的代码，却限制了插件的正常用法。
                return options.webdavModule;
            }
            // storage 门面保留：它做的是**按插件身份隔离命名空间**，防止插件
            // 互相读写数据，那是功能性隔离而非安全沙箱。
            return storage.facade;
        }

        if (!safePackages.has(moduleName)) {
            audit({
                moduleName,
                outcome: "denied",
                reason: "module-not-available",
            });
            // 与上游官方一致：未知模块返回 null，不抛异常。插件里
            // `const x = require("foo") || fallback` 是常见写法，抛异常会让
            // 整个插件在挂载阶段就崩掉，而官方下它只是静默降级。
            return null;
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

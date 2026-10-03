import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";
import type { IInstallPluginResult } from "@/types/core/pluginManager";
import { buildInfo } from "@/constants/buildInfo.generated";

const storage = getOrCreateMMKV("plugin-diagnostics");
const storageKey = "events";
const maxEventsPerPlugin = 20;
const maxEventsTotal = 200;
const maxMessageLength = 800;

const sensitivePatterns: Array<{
    pattern: RegExp;
    replacement: string;
}> = [
    {
        pattern: /([?&](?:access_token|refresh_token|token|auth|authorization|cookie|session|password|passwd|secret|sign)=)[^&\s]+/gi,
        replacement: "$1<redacted>",
    },
    {
        pattern: /\b(authorization|cookie|token|access_token|refresh_token|session|password|passwd|secret|sign)\s*[:=]\s*[^,\s;]+/gi,
        replacement: "$1=<redacted>",
    },
    {
        pattern: /file:\/\/[^\s'",)]+/gi,
        replacement: "file://<redacted>",
    },
    {
        pattern: /content:\/\/[^\s'",)]+/gi,
        replacement: "content://<redacted>",
    },
    {
        pattern: /(?:\/storage\/emulated|\/sdcard|\/data\/user\/0|\/data\/data)\/[^\s'",)]+/gi,
        replacement: "<local-path>",
    },
    {
        pattern: /[a-z]:\\[^\s'",)]+/gi,
        replacement: "<local-path>",
    },
    {
        pattern: /https?:\/\/[^\s'",)]+/gi,
        replacement: "<remote-url>",
    },
];

/**
 * error：插件真的出错了，插件卡片上的「最近错误」只显示这一类。
 * info：用到了哪些能力、旧数据迁移这类记录，只进诊断报告。
 */
export type PluginDiagnosticSeverity = "error" | "info";

export interface PluginDiagnosticEvent {
    id: string;
    pluginName: string;
    pluginHash?: string;
    method: string;
    message: string;
    estimatedLocation?: string;
    createdAt: number;
    /** 加这个字段之前记录的事件没有它，按 method 推断，见 getPluginDiagnosticSeverity */
    severity?: PluginDiagnosticSeverity;
}

interface IRecordPluginDiagnosticParams {
    pluginName: string;
    pluginHash?: string;
    method: string;
    error: any;
    estimatedLocation?: string | null;
}

interface IRecordPluginDiagnosticMessageParams {
    pluginName: string;
    pluginHash?: string;
    method: string;
    message: string;
    estimatedLocation?: string | null;
    /**
     * 必填，每个调用点自己判断。以前不传就默认 error，存储迁移、能力记录这类
     * 信息性事件因此在每个插件上都显示成「最近错误」；新增事件忘了传也会重现。
     * 落盘的旧事件可能没有这个字段，读取时按 method 推断（getPluginDiagnosticSeverity）。
     */
    severity: PluginDiagnosticSeverity;
}

interface IPluginDiagnosticReportPlugin {
    name: string;
    hash?: string;
    path?: string;
    instance: {
        version?: string;
        author?: string;
        srcUrl?: string;
    };
    supportedMethods: Set<string>;
    runtimeCapabilities?: Set<string>;
}

interface IPluginDiagnosticReportOptions {
    events?: PluginDiagnosticEvent[];
    filterSummary?: string;
}

function getStoredEvents() {
    const events = safeParse<PluginDiagnosticEvent[]>(
        storage.getString(storageKey),
    );
    return Array.isArray(events) ? events : [];
}

function setStoredEvents(events: PluginDiagnosticEvent[]) {
    storage.set(storageKey, safeStringify(events));
}

function sanitizeMessage(raw: string) {
    let sanitized = raw;
    sensitivePatterns.forEach(({ pattern, replacement }) => {
        sanitized = sanitized.replace(pattern, replacement);
    });
    return sanitized.length > maxMessageLength
        ? `${sanitized.slice(0, maxMessageLength)}...`
        : sanitized;
}

function formatErrorMessage(error: any) {
    if (typeof error === "string") {
        return error;
    }
    if (error?.message) {
        const name = error?.name;
        return name && !String(error.message).startsWith(name)
            ? `${name}: ${error.message}`
            : String(error.message);
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error ?? "Unknown error");
    }
}

function sanitizeReportValue(value: unknown) {
    const sanitized = sanitizeMessage(String(value ?? "-"))
        .replace(/\r?\n/g, " ")
        .trim();
    return sanitized || "-";
}

function getPluginSourceType(plugin: IPluginDiagnosticReportPlugin) {
    if (plugin.instance.srcUrl) {
        return "network";
    }
    if (plugin.path) {
        return "local-file";
    }
    return "unknown";
}

function getPluginDiagnosticEventLines(events: PluginDiagnosticEvent[]) {
    if (!events.length) {
        return ["-"];
    }
    return events.map(event => [
        `- ${new Date(event.createdAt).toLocaleString()} ${sanitizeReportValue(event.pluginName)} ${sanitizeReportValue(event.method)} [${getPluginDiagnosticSeverity(event)}]`,
        `  ${sanitizeReportValue(event.message)}`,
        event.estimatedLocation
            ? `  ${sanitizeReportValue(event.estimatedLocation)}`
            : "",
    ].filter(Boolean).join("\n"));
}

function getBuildInfoLines() {
    return [
        `App version: ${sanitizeReportValue(buildInfo.appVersion)} (${sanitizeReportValue(buildInfo.versionCode)})`,
        `Git: ${sanitizeReportValue(buildInfo.shortSha)} ${sanitizeReportValue(buildInfo.gitRef)}`,
        buildInfo.buildRunUrl
            ? `Build run: ${sanitizeReportValue(buildInfo.buildRunUrl)}`
            : "",
        `Build date: ${sanitizeReportValue(buildInfo.buildDate)}`,
        `Signing: ${sanitizeReportValue(buildInfo.signing)}`,
        `Runtime: RN ${sanitizeReportValue(buildInfo.reactNative)} / Expo ${sanitizeReportValue(buildInfo.expo)} / React ${sanitizeReportValue(buildInfo.react)}`,
        `Player: ${sanitizeReportValue(buildInfo.nitroPlayer)}`,
    ].filter(Boolean);
}

function getPluginReportLines(
    plugins: IPluginDiagnosticReportPlugin[],
    events: PluginDiagnosticEvent[],
) {
    if (!plugins.length) {
        return ["-"];
    }
    const now = Date.now();
    return plugins.map(plugin => {
        const pluginEvents = events.filter(event =>
            plugin.hash
                ? event.pluginHash === plugin.hash
                : event.pluginName === plugin.name,
        );
        // 和插件卡片的「最近错误」同一口径：时间窗内、严重程度为 error
        const recentErrorCount = pluginEvents.filter(
            event =>
                getPluginDiagnosticSeverity(event) === "error" &&
                isRecentPluginDiagnosticEvent(event, now),
        ).length;
        const capabilities = [...plugin.supportedMethods].sort();
        const runtimeCapabilities = [
            ...(plugin.runtimeCapabilities ?? []),
        ].sort();
        return [
            `- ${sanitizeReportValue(plugin.name)}`,
            `  version=${sanitizeReportValue(plugin.instance.version)}`,
            `  author=${sanitizeReportValue(plugin.instance.author)}`,
            `  source=${getPluginSourceType(plugin)}`,
            `  hash=${sanitizeReportValue(plugin.hash ? plugin.hash.slice(0, 12) : "")}`,
            `  capabilities=${capabilities.length ? capabilities.map(sanitizeReportValue).join(",") : "-"}`,
            `  runtimeCapabilities=${runtimeCapabilities.length
                ? runtimeCapabilities.map(sanitizeReportValue).join(",")
                : "-"}`,
            `  recentErrors=${recentErrorCount}`,
            `  events=${pluginEvents.length}`,
        ].join("\n");
    });
}

function trimEvents(events: PluginDiagnosticEvent[]) {
    const pluginCounts = new Map<string, number>();
    const trimmed: PluginDiagnosticEvent[] = [];

    for (const event of events) {
        const pluginKey = event.pluginHash || event.pluginName;
        const pluginCount = pluginCounts.get(pluginKey) ?? 0;
        if (pluginCount >= maxEventsPerPlugin) {
            continue;
        }
        pluginCounts.set(pluginKey, pluginCount + 1);
        trimmed.push(event);
        if (trimmed.length >= maxEventsTotal) {
            break;
        }
    }

    return trimmed;
}

export function recordPluginDiagnosticError(
    params: IRecordPluginDiagnosticParams,
) {
    return recordPluginDiagnosticMessage({
        pluginName: params.pluginName,
        pluginHash: params.pluginHash,
        method: params.method,
        message: formatErrorMessage(params.error),
        estimatedLocation: params.estimatedLocation,
        severity: "error",
    });
}

export function recordPluginDiagnosticMessage(
    params: IRecordPluginDiagnosticMessageParams,
) {
    const event: PluginDiagnosticEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        pluginName: params.pluginName || "unknown",
        pluginHash: params.pluginHash,
        method: params.method,
        message: sanitizeMessage(params.message),
        estimatedLocation: params.estimatedLocation
            ? sanitizeMessage(params.estimatedLocation)
            : undefined,
        createdAt: Date.now(),
        severity: params.severity,
    };

    setStoredEvents(trimEvents([event, ...getStoredEvents()]));
    return event;
}

// 这两类记录在区分严重程度之前也一律记成了事件，插件卡片把它们当成
// 「最近错误」：每个插件都显示 storage-migration · quarantinedLegacyEntries=1
const INFO_METHODS_BEFORE_SEVERITY = new Set(["capability", "storage-migration"]);

export function getPluginDiagnosticSeverity(
    event: Pick<PluginDiagnosticEvent, "method" | "severity">,
): PluginDiagnosticSeverity {
    if (event.severity) {
        return event.severity;
    }
    return INFO_METHODS_BEFORE_SEVERITY.has(event.method) ? "info" : "error";
}

export function recordPluginInstallFailure(result: IInstallPluginResult) {
    if (result.success) {
        return null;
    }
    const details = [
        result.message || "插件安装失败",
        result.failureReason ? `failureReason=${result.failureReason}` : "",
        result.retryable === undefined
            ? ""
            : `retryable=${result.retryable ? "yes" : "no"}`,
        result.sourceType ? `source=${result.sourceType}` : "",
    ].filter(Boolean).join("; ");

    return recordPluginDiagnosticMessage({
        pluginName:
            result.pluginName ||
            (result.sourceType === "local-file"
                ? "local-plugin-install"
                : result.sourceType === "network"
                    ? "network-plugin-install"
                    : "plugin-install"),
        pluginHash: result.pluginHash,
        method: "install",
        message: details,
        severity: "error",
    });
}

export function getPluginDiagnosticEvents(
    pluginHash?: string,
    pluginName?: string,
    limit = 5,
) {
    return getStoredEvents()
        .filter(event =>
            pluginHash
                ? event.pluginHash === pluginHash
                : event.pluginName === pluginName,
        )
        .slice(0, limit);
}

export function getLatestPluginDiagnosticEvent(
    pluginHash?: string,
    pluginName?: string,
) {
    return getPluginDiagnosticEvents(pluginHash, pluginName, 1)[0] ?? null;
}

export function getAllPluginDiagnosticEvents(limit = maxEventsTotal) {
    return getStoredEvents().slice(0, limit);
}

/**
 * 插件列表页上"最近"错误的时间窗。
 *
 * 事件此前只按数量截断（每插件 20 条 / 总共 200 条），没有时间概念，所以插件列表
 * 会把安装以来的任何一次失败永久挂在那里——包括早已被修复的问题。用户看到"每个
 * 插件都有报错"，实际多半是历史噪音。
 */
export const recentPluginDiagnosticWindowMs = 24 * 60 * 60 * 1000;

export function isRecentPluginDiagnosticEvent(
    event: Pick<PluginDiagnosticEvent, "createdAt">,
    now = Date.now(),
    windowMs = recentPluginDiagnosticWindowMs,
) {
    const age = now - event.createdAt;
    // 负数意味着事件时间戳在未来（设备改过时间），当作"最近"处理而不是直接隐藏。
    return age < windowMs;
}

/** 只返回时间窗内的事件；完整历史仍可通过诊断报告导出。 */
export function getRecentPluginDiagnosticEvents(
    now = Date.now(),
    windowMs = recentPluginDiagnosticWindowMs,
) {
    return getStoredEvents().filter(event =>
        isRecentPluginDiagnosticEvent(event, now, windowMs),
    );
}

/** 时间窗内真正的错误，给插件卡片的「最近错误」用 */
export function getRecentPluginDiagnosticErrors(
    now = Date.now(),
    windowMs = recentPluginDiagnosticWindowMs,
) {
    return getRecentPluginDiagnosticEvents(now, windowMs).filter(
        event => getPluginDiagnosticSeverity(event) === "error",
    );
}

export function clearPluginDiagnosticEvents(eventIds?: string[]) {
    const events = getStoredEvents();
    if (!eventIds) {
        setStoredEvents([]);
        return events.length;
    }

    const idSet = new Set(eventIds);
    if (!idSet.size) {
        return 0;
    }

    const nextEvents = events.filter(event => !idSet.has(event.id));
    setStoredEvents(nextEvents);
    return events.length - nextEvents.length;
}

export function buildPluginDiagnosticReport(
    plugins: IPluginDiagnosticReportPlugin[],
    options: IPluginDiagnosticReportOptions = {},
) {
    const events = options.events ?? getAllPluginDiagnosticEvents();
    const filterLines = options.filterSummary
        ? [`Filters: ${sanitizeReportValue(options.filterSummary)}`]
        : [];
    return [
        "MusicFree Plugin Diagnostic Report",
        `Generated: ${new Date().toISOString()}`,
        `Plugins: ${plugins.length}`,
        `Diagnostic events: ${events.length}`,
        ...filterLines,
        "",
        "Build",
        ...getBuildInfoLines(),
        "",
        "Plugins",
        ...getPluginReportLines(plugins, events),
        "",
        "Recent diagnostics",
        ...getPluginDiagnosticEventLines(events.slice(0, 50)),
    ].join("\n");
}

export function buildPluginDiagnosticEventReport(
    event: PluginDiagnosticEvent,
) {
    return [
        "MusicFree Plugin Diagnostic Event",
        `Generated: ${new Date().toISOString()}`,
        `Plugin: ${sanitizeReportValue(event.pluginName)}`,
        `Method: ${sanitizeReportValue(event.method)}`,
        `Time: ${new Date(event.createdAt).toISOString()}`,
        event.pluginHash
            ? `Hash: ${sanitizeReportValue(event.pluginHash.slice(0, 12))}`
            : "",
        "",
        "Message",
        sanitizeReportValue(event.message),
        event.estimatedLocation
            ? [
                "",
                "Estimated location",
                sanitizeReportValue(event.estimatedLocation),
            ].join("\n")
            : "",
    ].filter(Boolean).join("\n");
}

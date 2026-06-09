import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";

const storage = getOrCreateMMKV("plugin-diagnostics");
const storageKey = "events";
const maxEventsPerPlugin = 20;
const maxEventsTotal = 200;
const maxMessageLength = 800;

const sensitivePatterns = [
    /([?&](?:access_token|refresh_token|token|auth|authorization|cookie|session|password|passwd|secret|sign)=)[^&\s]+/gi,
    /\b(authorization|cookie|token|access_token|refresh_token|session|password|passwd|secret|sign)\s*[:=]\s*[^,\s;]+/gi,
];

export interface PluginDiagnosticEvent {
    id: string;
    pluginName: string;
    pluginHash?: string;
    method: string;
    message: string;
    estimatedLocation?: string;
    createdAt: number;
}

interface IRecordPluginDiagnosticParams {
    pluginName: string;
    pluginHash?: string;
    method: string;
    error: any;
    estimatedLocation?: string | null;
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
    sensitivePatterns.forEach(pattern => {
        sanitized = sanitized.replace(pattern, "$1<redacted>");
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
    const event: PluginDiagnosticEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        pluginName: params.pluginName || "unknown",
        pluginHash: params.pluginHash,
        method: params.method,
        message: sanitizeMessage(formatErrorMessage(params.error)),
        estimatedLocation: params.estimatedLocation || undefined,
        createdAt: Date.now(),
    };

    setStoredEvents(trimEvents([event, ...getStoredEvents()]));
    return event;
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

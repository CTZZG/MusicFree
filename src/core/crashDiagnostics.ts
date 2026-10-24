import NativeUtils, {
    type INativeCrashDiagnostics,
    type INativeCrashSummary,
    type INativeJavaCrash,
    type INativeProcessExit,
} from "@/native/utils";

/**
 * 本机的崩溃和退出记录（原生侧见 android/.../diagnostics/CrashDiagnostics.kt）。
 * 只在用户复制诊断时读取，不联网、不上传。异常消息里可能带播放地址或 Cookie，
 * 读出来后先遮掉查询参数和凭据。
 */
export interface ICrashDiagnosticsReport {
    available: boolean;
    error?: string;
    clearedBefore?: number;
    /** 记录里有几次崩溃、无响应或被系统因资源强杀 */
    abnormalExitCount?: number;
    javaCrashes?: INativeJavaCrash[];
    exits?: INativeProcessExit[];
}

const SECRET_PARAMETER = /(authorization|cookie|token|password|passwd|secret|sign|signature|key)=([^&\s"']+)/gi;
const SECRET_HEADER = /(authorization|cookie|set-cookie|token|password):\s*([^\n]+)/gi;
const URL_QUERY = /\b(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi;
const URL_CREDENTIALS = /(\bhttps?:\/\/)[^\s/?#"'<>]*@/gi;
const QUOTED_SECRET = /(["'](?:authorization|cookie|set-cookie|token|access[_-]?token|password|passwd|secret|sign|signature|(?:api[_-]?)?key)["']\s*:\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi;
const SECRET_KEY = /^(?:authorization|cookie|set-cookie|token|access[_-]?token|password|passwd|secret|sign|signature|(?:api[_-]?)?key)$/i;
// Include a truncated last literal (native records have a length cap), but not the next stack line.
const JSON_STRING = /"(?:\\.|[^"\\\r\n])*(?:"|\\?(?=\r?\n|$))/g;
const MAX_REDACTION_DEPTH = 12;
const NESTING_LIMIT = "[redacted: nesting limit]";

function redactPlainText(value: string): string {
    return value
        .replace(/\bhttps?:\\\/\\\/[^\s"'<>]*/gi, url => url.replace(/\\\//g, "/"))
        .replace(URL_CREDENTIALS, "$1***@")
        .replace(URL_QUERY, "$1?…")
        .replace(QUOTED_SECRET, "$1\"***\"")
        .replace(SECRET_PARAMETER, "$1=***")
        .replace(SECRET_HEADER, "$1: ***");
}

function redactJsonValue(value: unknown, depth: number): unknown {
    if (typeof value === "string") return redactText(value, depth);
    if (value === null || typeof value !== "object") return value;
    if (depth >= MAX_REDACTION_DEPTH) return NESTING_LIMIT;
    if (Array.isArray(value)) {
        return value.map(item => redactJsonValue(item, depth + 1));
    }
    // fromEntries also preserves a literal __proto__ field without invoking its setter.
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key, SECRET_KEY.test(key) ? "***" : redactJsonValue(item, depth + 1),
    ]));
}

function redactText(value: string, depth: number): string {
    if (depth >= MAX_REDACTION_DEPTH) return NESTING_LIMIT;
    // Exceptions can contain a JSON response whose message is itself serialized JSON.
    // Decode before matching keys so escaped quotes/slashes cannot hide credentials.
    if (/^\s*[[{"]/.test(value)) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(value);
        } catch {
            // A stack/prose prefix or malformed JSON still needs the text fallback below.
        }
        if (parsed !== undefined) {
            const redacted = JSON.stringify(redactJsonValue(parsed, depth + 1));
            return redacted === JSON.stringify(parsed) ? value : redacted;
        }
    }
    const decoded = value.replace(JSON_STRING, literal => {
        let text: string;
        try {
            text = JSON.parse(literal);
        } catch {
            // Do not copy a truncated/invalid serialized value that we could not decode safely.
            return JSON.stringify("[redacted: invalid JSON string]");
        }
        const redacted = redactText(text, depth + 1);
        return redacted === text ? literal : JSON.stringify(redacted);
    });
    return redactPlainText(decoded);
}

/** 遮掉地址和嵌套 JSON 的凭据；超过解析深度时隐藏该片段，不导出未处理的值。 */
export function redactCrashText(value: string): string {
    return redactText(value, 0);
}

function redactOptional(value: string | undefined) {
    return value === undefined ? undefined : redactCrashText(value);
}

function redactNativeCrash(summary: INativeCrashSummary): INativeCrashSummary {
    return {
        ...summary,
        thread: redactOptional(summary.thread),
        abortMessage: redactOptional(summary.abortMessage),
        causes: summary.causes.map(redactCrashText),
        frames: summary.frames.map(redactCrashText),
    };
}

function redactExit(exit: INativeProcessExit): INativeProcessExit {
    return {
        ...exit,
        description: redactOptional(exit.description),
        anrMainThread: redactOptional(exit.anrMainThread),
        nativeCrash: exit.nativeCrash ? redactNativeCrash(exit.nativeCrash) : undefined,
    };
}

export function buildCrashDiagnosticsReport(
    raw: INativeCrashDiagnostics,
): ICrashDiagnosticsReport {
    const exits = raw.exits.map(redactExit);
    return {
        available: true,
        clearedBefore: raw.clearedBefore,
        abnormalExitCount: exits.filter(exit => exit.abnormal).length,
        javaCrashes: raw.javaCrashes.map(crash => ({
            ...crash,
            thread: redactCrashText(crash.thread),
            appVersion: redactCrashText(crash.appVersion),
            exception: redactCrashText(crash.exception),
            message: redactCrashText(crash.message),
            stack: redactCrashText(crash.stack),
        })),
        exits,
    };
}

export async function loadCrashDiagnostics(): Promise<ICrashDiagnosticsReport> {
    if (!NativeUtils?.getCrashDiagnostics) {
        return { available: false, error: "native method unavailable" };
    }
    try {
        return buildCrashDiagnosticsReport(await NativeUtils.getCrashDiagnostics());
    } catch (error: any) {
        return {
            available: false,
            error: redactCrashText(String(error?.message ?? error ?? "")),
        };
    }
}

/** 和错误日志一起清；清不掉不影响清日志本身 */
export async function clearCrashDiagnostics() {
    try {
        return (await NativeUtils?.clearCrashDiagnostics?.()) ?? false;
    } catch {
        return false;
    }
}

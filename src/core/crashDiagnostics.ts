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

/** 遮掉地址的查询串和凭据，保留协议、主机和路径，方便判断是哪个服务出的错。 */
export function redactCrashText(value: string): string {
    return value
        .replace(URL_QUERY, "$1?…")
        .replace(SECRET_PARAMETER, "$1=***")
        .replace(SECRET_HEADER, "$1: ***");
}

function redactOptional(value: string | undefined) {
    return value === undefined ? undefined : redactCrashText(value);
}

function redactNativeCrash(summary: INativeCrashSummary): INativeCrashSummary {
    return {
        ...summary,
        abortMessage: redactOptional(summary.abortMessage),
        causes: summary.causes.map(redactCrashText),
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

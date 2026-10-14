import { NativeModules } from "react-native";

/**
 * 性能基线用的时间点：交给原生写到 logcat（标签 MusicFreePerf），端到端测试
 * （e2e/perf.sh）读这些行算耗时。时间用这里记下的墙钟毫秒，和原生的时间点可以直接相减。
 * 发布版会去掉 console，所以不用 console.log。没有原生模块（单元测试）时什么也不做。
 */
export function perfMark(
    name: string,
    detail?: Record<string, string | number | boolean | null | undefined>,
) {
    const atMs = Date.now();
    try {
        NativeModules.NativeUtils?.perfMark?.(name, atMs, formatPerfDetail(detail));
    } catch {
        // 只是日志，失败不影响任何行为
    }
}

const markedOnce = new Set<string>();

/** 每个名字整个进程里只记一次（例如启动后第一次显示主页） */
export function perfMarkOnce(
    name: string,
    detail?: Record<string, string | number | boolean | null | undefined>,
) {
    if (markedOnce.has(name)) {
        return;
    }
    markedOnce.add(name);
    perfMark(name, detail);
}

export function formatPerfDetail(
    detail?: Record<string, string | number | boolean | null | undefined>,
) {
    if (!detail) {
        return "";
    }
    return Object.entries(detail)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, "_")}`)
        .join(" ");
}

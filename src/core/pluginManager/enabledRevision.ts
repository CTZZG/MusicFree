import { useEffect, useState } from "react";

const listeners = new Set<() => void>();
let runtimeRevision = 0;

/** Includes disable/enable ABA and configuration changes while a request is in flight. */
export function getPluginRuntimeRevision() {
    return runtimeRevision;
}

export function subscribePluginRuntimeRevision(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** 插件列表替换、启停状态变化或用户变量修改后调用。 */
export function notifyPluginRuntimeChanged() {
    runtimeRevision += 1;
    listeners.forEach(listener => listener());
}

/**
 * 插件列表、启停状态或用户变量变化时更新。凡是依赖插件运行状态计算的结果都
 * 要把它放进依赖：例如停用插件时，列表本身未变，旧 useMemo 仍会引用停用前的音源。
 */
export function usePluginRuntimeRevision() {
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        const listener = () => {
            setRevision(value => value + 1);
        };
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);

    return revision;
}

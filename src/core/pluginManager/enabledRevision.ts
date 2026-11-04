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

/** 插件启用状态落盘之后调用 */
export function notifyPluginEnabledChanged() {
    runtimeRevision += 1;
    listeners.forEach(listener => listener());
}

/**
 * 任一插件启用或停用时加一。凡是按「哪些插件启用」算出来的结果，都要把它放进
 * 依赖：停用插件时插件列表本身不变，只依赖列表的 useMemo 会一直沿用停用前的
 * 结果（例如首页还在用刚停用的音源）。
 */
export function usePluginEnabledRevision() {
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

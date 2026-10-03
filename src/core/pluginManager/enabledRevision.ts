import { useEffect, useState } from "react";

const listeners = new Set<() => void>();

/** 插件启用状态落盘之后调用 */
export function notifyPluginEnabledChanged() {
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

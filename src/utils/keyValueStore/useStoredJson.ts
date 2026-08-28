import { useEffect, useState } from "react";

import type { IKeyValueStore } from "./types";

function readJson<T>(store: IKeyValueStore, key: string): T | undefined {
    const raw = store.getString(key);
    if (raw === undefined) {
        return undefined;
    }
    try {
        return JSON.parse(raw) as T;
    } catch {
        // 坏值当作缺失。这里不删除——删除属于写操作，放在读 hook 里会让
        // 渲染产生副作用；清理由 AppConfig.getConfig 负责。
        return undefined;
    }
}

/**
 * 订阅某个键的 JSON 值，替代 react-native-mmkv 的 useMMKVObject。
 *
 * 与它行为一致：初次渲染同步读到当前值，之后该键变化时重渲染。
 */
export default function useStoredJson<T>(
    key: string,
    store: IKeyValueStore,
): T | undefined {
    const [value, setValue] = useState<T | undefined>(() =>
        readJson<T>(store, key),
    );

    useEffect(() => {
        // 订阅建立前值可能已经变了（例如 hydrate 刚完成），先同步一次。
        setValue(readJson<T>(store, key));
        const subscription = store.addOnValueChangedListener(changedKey => {
            if (changedKey === key) {
                setValue(readJson<T>(store, key));
            }
        });
        return () => subscription.remove();
    }, [key, store]);

    return value;
}

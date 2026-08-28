/**
 * 媒体资源的附加属性
 */
import getOrCreateMMKV, { hydrateKeyValueStore } from "@/utils/getOrCreateMMKV";
import { getMediaUniqueKey } from "@/utils/mediaIdentity";
import type { DownloadWriteResult } from "@/core/downloadFinalizationPolicy";
import { useEffect, useState } from "react";
import { safeParse } from "./jsonUtil";

/**
 * 已触发过 hydrate 的插件 store，避免重复挂 then。
 *
 * 附加属性 store 按插件动态创建，不在启动预载列表里。文件存储的读取需要先
 * 异步读盘，所以首次同步读会拿到空值——对本模块而言那只是降级（歌曲显示为
 * 未下载、歌词偏移为 0），不是丢数据。读盘完成后通知观察者重渲染即可自愈。
 */
const hydratedPluginStores = new Set<string>();

// Internal Method
const getPluginStore = (pluginName: string) => {
    const store = getOrCreateMMKV(`MediaExtra.${pluginName}`);
    if (!hydratedPluginStores.has(pluginName)) {
        hydratedPluginStores.add(pluginName);
        void hydrateKeyValueStore(`MediaExtra.${pluginName}`)
            .then(emitMediaExtraChanged)
            .catch(() => undefined);
    }
    return store;
};

/** 音乐的附加属性 */
interface IMediaExtraProperties {
    /** 是否已下载 */
    downloaded?: boolean;
    /** 本地路径 */
    localPath?: string;
    /** 下载元数据写入状态 */
    downloadMetadataStatus?: DownloadWriteResult;
    /** 独立歌词文件写入状态 */
    downloadLyricStatus?: DownloadWriteResult;
    /** 歌词偏移 */
    lyricOffset?: number;
    /** 关联歌词 */
    associatedLrc?: ICommon.IMediaBase
}


const observerCallbacks = new Map<string, Set<(extra: IMediaExtraProperties | null) => void>>();
const globalObserverCallbacks = new Set<() => void>();

function normalizeMediaExtraProperties(
    meta: unknown,
): IMediaExtraProperties | null {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
        return null;
    }
    return meta as IMediaExtraProperties;
}

function getMediaExtraObserverKey(
    mediaItem: ICommon.IMediaBase | null | undefined,
) {
    return mediaItem?.platform && mediaItem.id
        ? getMediaUniqueKey(mediaItem)
        : null;
}

function emitMediaExtraChanged() {
    for (const callback of globalObserverCallbacks) {
        callback();
    }
}

/**
 * 获取媒体资源的全部附加属性
 * @param mediaItem 媒体资源
 * @returns 
 */
function getMediaExtra(mediaItem: ICommon.IMediaBase | null | undefined): IMediaExtraProperties | null {
    if (!mediaItem?.platform || !mediaItem.id) {
        return null;
    }

    const meta = getPluginStore(mediaItem.platform).getString(
        `${mediaItem.id}`,
    );
    if (!meta) {
        return null;
    }
    const parsedMeta = safeParse<IMediaExtraProperties>(meta);
    return normalizeMediaExtraProperties(parsedMeta);
}


/**
 * 获取媒体资源的附加属性值
 * @param mediaItem 
 * @param key 
 * @returns 
 */
function getMediaExtraProperty<K extends keyof IMediaExtraProperties>(mediaItem: ICommon.IMediaBase | null | undefined, key: K): IMediaExtraProperties[K] | null {
    const meta = getMediaExtra(mediaItem);
    return meta ? meta[key] : null;
}

/**
 * 更新媒体资源的附加属性
 * @param mediaItem 媒体资源
 * @param extra 附加属性
 * @returns 
 */
function patchMediaExtra(mediaItem: ICommon.IMediaBase, extra: Partial<IMediaExtraProperties>) {
    if (!mediaItem.platform || !mediaItem.id) {
        return null;
    }

    const originalMeta = getMediaExtra(mediaItem);
    const store = getPluginStore(mediaItem.platform);
    const newMeta = {
        ...originalMeta,
        ...extra,
    };
    store.set(`${mediaItem.id}`, JSON.stringify(newMeta));

    // 发送事件更新
    const callbacks = observerCallbacks.get(getMediaUniqueKey(mediaItem));
    if (callbacks && callbacks.size > 0) {
        for (const callback of callbacks) {
            callback(newMeta);
        }
    }
    emitMediaExtraChanged();

    return newMeta;
}

/**
 * 直接替换媒体资源的附加属性
 * @param mediaItem 媒体资源
 * @param extra 附加属性
 * @returns 
 */
function setMediaExtra(mediaItem: ICommon.IMediaBase, extra: IMediaExtraProperties) {
    if (!mediaItem.platform || !mediaItem.id) {
        return null;
    }
    const store = getPluginStore(mediaItem.platform);
    store.set(`${mediaItem.id}`, JSON.stringify(extra));

    // 发送事件更新
    const callbacks = observerCallbacks.get(getMediaUniqueKey(mediaItem));
    if (callbacks && callbacks.size > 0) {
        for (const callback of callbacks) {
            callback(extra);
        }
    }
    emitMediaExtraChanged();

    return extra;
}

/**
 * 删除媒体资源的附加属性
 * @param mediaItem 媒体资源
 * @returns 
 */
function removeMediaExtra(mediaItem: ICommon.IMediaBase) {
    if (!mediaItem.platform || !mediaItem.id) {
        return false;
    }
    const store = getPluginStore(mediaItem.platform);
    store.delete(`${mediaItem.id}`);

    // 发送事件更新
    const callbacks = observerCallbacks.get(getMediaUniqueKey(mediaItem));
    if (callbacks && callbacks.size > 0) {
        for (const callback of callbacks) {
            callback(null);
        }
    }
    emitMediaExtraChanged();

    return true;
}

/**
 * 删除所有媒体资源的附加属性
 * @param pluginName 插件名称
 */
function removeAllMediaExtra(pluginName: string) {
    const store = getPluginStore(pluginName);
    store.clearAll();

    // 寻找所有pluginName开头的key
    const keys = observerCallbacks.keys();
    for (const key of keys) {
        if (key.startsWith(pluginName + "@")) {
            const callbacks = observerCallbacks.get(key);

            if (callbacks && callbacks.size > 0) {
                for (const callback of callbacks) {
                    callback(null);
                }
            }
        }
    }
    emitMediaExtraChanged();
}

function useMediaExtraVersion() {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const callback = () => setVersion(prev => prev + 1);
        globalObserverCallbacks.add(callback);
        return () => {
            globalObserverCallbacks.delete(callback);
        };
    }, []);

    return version;
}


function useMediaExtra(mediaItem: ICommon.IMediaBase | null | undefined) {
    const [mediaExtraState, setMediaExtraState] = useState<IMediaExtraProperties | null>(getMediaExtra(mediaItem));

    useEffect(() => {
        const callback = (mediaExtra: IMediaExtraProperties | null) => {
            setMediaExtraState(mediaExtra);
        };
        const mediaKey = getMediaExtraObserverKey(mediaItem);


        if (!mediaKey) {
            setMediaExtraState(null);
        } else {
            setMediaExtraState(getMediaExtra(mediaItem));

            if (!observerCallbacks.has(mediaKey)) {
                observerCallbacks.set(mediaKey, new Set());
            }
            const callbacks = observerCallbacks.get(mediaKey);
            if (callbacks) {
                callbacks.add(callback);
            }
        }


        return () => {
            if (mediaKey && observerCallbacks.has(mediaKey)) {
                const callbacks = observerCallbacks.get(mediaKey);
                if (callbacks) {
                    callbacks.delete(callback);
                    if (callbacks.size === 0) {
                        observerCallbacks.delete(mediaKey);
                    }
                }

            }
        };
    }, [mediaItem]);

    return mediaExtraState;
}


function useMediaExtraProperty<K extends keyof IMediaExtraProperties>(mediaItem: ICommon.IMediaBase | null | undefined, key: K) {
    const [mediaExtraPropertyState, setMediaExtraPropertyState] = useState<IMediaExtraProperties[K] | null>(getMediaExtraProperty(mediaItem, key));

    useEffect(() => {
        const callback = (mediaExtra: IMediaExtraProperties | null) => {
            setMediaExtraPropertyState(mediaExtra ? mediaExtra[key] : null);
        };
        const mediaKey = getMediaExtraObserverKey(mediaItem);

        if (!mediaKey) {
            setMediaExtraPropertyState(null);
        } else {
            setMediaExtraPropertyState(getMediaExtraProperty(mediaItem, key));

            if (!observerCallbacks.has(mediaKey)) {
                observerCallbacks.set(mediaKey, new Set());
            }
            const callbacks = observerCallbacks.get(mediaKey);
            if (callbacks) {
                callbacks.add(callback);
            }
        }


        return () => {
            if (mediaKey && observerCallbacks.has(mediaKey)) {
                const callbacks = observerCallbacks.get(mediaKey);
                if (callbacks) {
                    callbacks.delete(callback);
                    if (callbacks.size === 0) {
                        observerCallbacks.delete(mediaKey);
                    }
                }
            }
        };
    }, [mediaItem, key]);

    return mediaExtraPropertyState;
}


export {
    getMediaExtra,
    getMediaExtraProperty,
    patchMediaExtra,
    setMediaExtra,
    removeMediaExtra,
    removeAllMediaExtra,
    normalizeMediaExtraProperties,
    getMediaExtraObserverKey,
    useMediaExtra,
    useMediaExtraProperty,
    useMediaExtraVersion,
};

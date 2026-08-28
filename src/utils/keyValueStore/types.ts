/**
 * 键值存储的抽象接口。
 *
 * 形状刻意与 react-native-mmkv 的常用子集保持一致，让既有的十几个调用点
 * 无需改写：读取同步、写入立即在内存生效、落盘异步。
 */
export interface IKeyValueStore {
    /** 同步读。值不存在时返回 undefined。 */
    getString(key: string): string | undefined;
    getNumber(key: string): number | undefined;
    getBoolean(key: string): boolean | undefined;
    /** 写入。number/boolean 会按各自类型存储，其余按字符串。 */
    set(key: string, value: string | number | boolean): void;
    delete(key: string): void;
    /** 与 delete 同义，兼容 MMKV 的 remove。 */
    remove(key: string): void;
    contains(key: string): boolean;
    getAllKeys(): string[];
    clearAll(): void;
    /** 已存储的键数量。MMKV 的 size 是字节数，这里是键数——见下方说明。 */
    readonly size: number;
    /** MMKV 的碎片整理，对本实现是空操作。 */
    trim(): void;
    addOnValueChangedListener(
        listener: (key: string) => void,
    ): { remove(): void };
}

/**
 * 存储值的内部表示。区分类型是为了让 getNumber/getBoolean 不必猜测，
 * 也让 JSON 快照能无损往返。
 */
export type StoredValue =
    | { t: "s"; v: string }
    | { t: "n"; v: number }
    | { t: "b"; v: boolean };

export interface IStoreSnapshot {
    /** 快照格式版本，便于日后演进。 */
    version: 1;
    entries: Record<string, StoredValue>;
}

/** 落盘后端。实现方只需能读写一整份文本。 */
export interface IStorePersistence {
    read(storeId: string): Promise<string | null>;
    write(storeId: string, contents: string): Promise<void>;
    remove(storeId: string): Promise<void>;
}

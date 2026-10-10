import RNFS from "react-native-fs";

import type { IStorePersistence } from "./types";

/**
 * 键值存储的落盘目录。
 *
 * 刻意用 `DocumentDirectoryPath`（Android 上是 /data/data/<pkg>/files，真正的
 * 应用私有内部存储），而不是项目其余部分用的 `ExternalDirectoryPath`
 * （/sdcard/Android/data/<pkg>/files）。
 *
 * 这是抛弃 MMKV 的直接原因：MMKV 依赖 mmap 把内存页写回文件，而外部存储在
 * 现代 Android 上是 FUSE 挂载（sdcardfs/FuseDaemon），并不保证 mmap 的写回
 * 语义。表现就是配置在界面上改了、内存里生效了，文件 mtime 却纹丝不动，
 * 重启后全部还原——而且整个过程没有任何错误可观察。
 *
 * 内部存储是普通 ext4/f2fs，常规文件读写语义完备。代价是用户无法直接用文件
 * 管理器查看，但这些本来就是应用私有状态，不该被手动编辑。
 */
export const KV_STORE_DIR = `${RNFS.DocumentDirectoryPath}/kvstore`;

/**
 * store 的文件路径。
 *
 * store id 里可能出现 `.` 和用户数据派生的片段（LocalSheet.<id>、
 * MediaExtra.<pluginName>），必须编码，否则插件名里的 `/` 会写到别的目录去。
 *
 * 编码后的文件名里不能有 `%`：react-native-fs 在 Android 上读写文件
 * （readFile、writeFile）时把路径当成 file:// 地址解析，`%E6%B5%8B` 这样的转义
 * 会被还原成原来的字符；判断存在、改名、删除（exists、moveFile、unlink）却按
 * 字面路径。文件名带 `%` 时两边对不上：内容写到了还原后的名字，下次启动按字面
 * 的名字找不到，这个 store 每次启动都从空开始（迁移标记也读不回来，旧版数据
 * 每次都重新迁移一遍）。所以 encodeURIComponent 之后把 `%` 换成 `+`；
 * encodeURIComponent 本身会转义 `+`，两个不同的 id 不会得到同一个文件名。
 */
function storePath(storeId: string) {
    return `${KV_STORE_DIR}/${encodeURIComponent(storeId).replace(/%/g, "+")}.json`;
}

/** 新文件名只会由这些字符组成（encodeURIComponent 不转义的字符，加上 `+`）。 */
const STORE_FILE_NAME_CHARS = /^[A-Za-z0-9\-_.!~*'()+]*$/;

interface ILegacyLocation {
    /** 用来读旧文件的路径：Android 上会被还原成实际写到的名字，其他平台按字面读。 */
    readPath: string;
    /** 旧文件实际可能在的位置（按字面判断存在、删除）。 */
    paths: string[];
}

/**
 * 文件名里还带 `%` 的版本把这个 store 写在哪里（见 storePath）。id 不需要转义
 * 时文件名没变过，返回 null。
 *
 * - Android 上实际写到了还原后的名字，也就是 store id 原样。id 里有 `/` 的写不
 *   出来（目录不存在），不去看；只由新文件名字符组成的 id，原样的名字可能正好是
 *   另一个 store 的新文件，也不去看，免得读错、删错。
 * - 其他平台按字面写到了 encodeURIComponent 的名字。
 */
function legacyLocation(storeId: string): ILegacyLocation | null {
    const encoded = encodeURIComponent(storeId);
    if (!encoded.includes("%")) {
        return null;
    }
    const readPath = `${KV_STORE_DIR}/${encoded}.json`;
    const paths = [readPath];
    if (!storeId.includes("/") && !STORE_FILE_NAME_CHARS.test(storeId)) {
        paths.push(`${KV_STORE_DIR}/${storeId}.json`);
    }
    return { readPath, paths };
}

/** 读到过旧文件、还没清理的 store：新文件写成功后删掉旧文件。 */
const legacyToCleanUp = new Map<string, ILegacyLocation>();

async function removeLegacyFiles(location: ILegacyLocation) {
    for (const path of location.paths) {
        // 旧版写入时留下的临时文件也在还原后的名字上
        for (const candidate of [path, `${path}.tmp`]) {
            try {
                if (await RNFS.exists(candidate)) {
                    await RNFS.unlink(candidate);
                }
            } catch {
                // 清理失败不影响正确性：新文件已经在了，读的时候先读新文件
            }
        }
    }
}

let ensureDirPromise: Promise<void> | null = null;

async function ensureDir() {
    ensureDirPromise ??= (async () => {
        if (!(await RNFS.exists(KV_STORE_DIR))) {
            await RNFS.mkdir(KV_STORE_DIR);
        }
    })();
    try {
        await ensureDirPromise;
    } catch (error) {
        // 失败后允许下次重试，否则一次瞬时错误会永久禁用落盘。
        ensureDirPromise = null;
        throw error;
    }
}

/**
 * 原子写入：先写临时文件再改名。直接覆写会在进程于写入中途被杀时留下半份
 * 文件——那正是 JSON 解析失败、整份配置归零的场景。rename 在同一文件系统内
 * 是原子的，读到的要么是旧的完整内容、要么是新的完整内容。
 */
async function atomicWrite(filePath: string, contents: string) {
    const tempPath = `${filePath}.tmp`;
    await RNFS.writeFile(tempPath, contents, "utf8");
    try {
        await RNFS.moveFile(tempPath, filePath);
    } catch {
        // 某些实现下目标已存在会导致 moveFile 失败，退化为「删除后重命名」。
        // 这段窗口内文件缺失，但下一次写入会补上，且比留下半份文件安全。
        try {
            if (await RNFS.exists(filePath)) {
                await RNFS.unlink(filePath);
            }
            await RNFS.moveFile(tempPath, filePath);
        } catch (fallbackError) {
            try {
                await RNFS.unlink(tempPath);
            } catch {
                // 临时文件清理失败不影响正确性，下次写入会覆盖它。
            }
            throw fallbackError;
        }
    }
}

export function createFilePersistence(): IStorePersistence {
    return {
        async read(storeId) {
            await ensureDir();
            const filePath = storePath(storeId);
            if (await RNFS.exists(filePath)) {
                return await RNFS.readFile(filePath, "utf8");
            }
            // 新文件还没有：把旧版本写下的内容接过来，下次写入新文件后删掉旧的
            const legacy = legacyLocation(storeId);
            if (!legacy) {
                return null;
            }
            for (const path of legacy.paths) {
                if (await RNFS.exists(path)) {
                    try {
                        const contents = await RNFS.readFile(legacy.readPath, "utf8");
                        legacyToCleanUp.set(storeId, legacy);
                        return contents;
                    } catch {
                        // 读不出来的旧文件就当没有，也不删它
                        return null;
                    }
                }
            }
            return null;
        },
        async write(storeId, contents) {
            await ensureDir();
            await atomicWrite(storePath(storeId), contents);
            const legacy = legacyToCleanUp.get(storeId);
            if (legacy) {
                legacyToCleanUp.delete(storeId);
                await removeLegacyFiles(legacy);
            }
        },
        async remove(storeId) {
            const filePath = storePath(storeId);
            if (await RNFS.exists(filePath)) {
                await RNFS.unlink(filePath);
            }
            const legacy = legacyLocation(storeId);
            if (legacy) {
                legacyToCleanUp.delete(storeId);
                await removeLegacyFiles(legacy);
            }
        },
    };
}

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

function storePath(storeId: string) {
    // store id 里可能出现 `.` 和用户数据派生的片段（LocalSheet.<id>、
    // MediaExtra.<pluginName>），必须编码，否则插件名里的 `/` 会写到别的目录去。
    return `${KV_STORE_DIR}/${encodeURIComponent(storeId)}.json`;
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
            if (!(await RNFS.exists(filePath))) {
                return null;
            }
            return await RNFS.readFile(filePath, "utf8");
        },
        async write(storeId, contents) {
            await ensureDir();
            await atomicWrite(storePath(storeId), contents);
        },
        async remove(storeId) {
            const filePath = storePath(storeId);
            if (await RNFS.exists(filePath)) {
                await RNFS.unlink(filePath);
            }
        },
    };
}

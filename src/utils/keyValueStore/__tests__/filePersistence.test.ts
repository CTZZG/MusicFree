/**
 * 文件存储在 Android 上的 react-native-fs 语义下的读写。
 *
 * 假的 react-native-fs 照 Android 版的实现：readFile、writeFile（以及 moveFile
 * 改名失败后的复制）把路径当成 file:// 地址解析，`%XX` 会被还原、`#` `?` 之后
 * 被当成地址的其他部分；exists、moveFile 的改名、unlink 按字面路径。
 */
jest.mock("react-native-fs", () => {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    // Uri.parse("file://" + path).getPath()
    const uriPath = (path: string) => {
        const raw = path.split(/[?#]/)[0];
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    };
    const enoent = (path: string) =>
        Object.assign(new Error(`ENOENT: open '${path}'`), { code: "ENOENT" });
    return {
        __esModule: true,
        default: {
            DocumentDirectoryPath: "/data/user/0/app/files",
            async exists(path: string) {
                return files.has(path) || dirs.has(path);
            },
            async mkdir(path: string) {
                dirs.add(path);
            },
            async readFile(path: string) {
                const content = files.get(uriPath(path));
                if (content === undefined) {
                    throw enoent(path);
                }
                return content;
            },
            async writeFile(path: string, content: string) {
                files.set(uriPath(path), content);
            },
            async moveFile(from: string, to: string) {
                if (files.has(from)) {
                    files.set(to, files.get(from)!);
                    files.delete(from);
                    return;
                }
                // renameTo 失败，CopyFileTask 按地址复制，再按字面删源文件
                const content = files.get(uriPath(from));
                if (content === undefined) {
                    throw enoent(from);
                }
                files.set(uriPath(to), content);
                files.delete(from);
            },
            async unlink(path: string) {
                if (!files.delete(path)) {
                    throw new Error("File does not exist");
                }
            },
        },
        mockFiles: files,
    };
});

import { createFilePersistence, KV_STORE_DIR } from "../filePersistence";

const files: Map<string, string> = jest.requireMock("react-native-fs").mockFiles;

function names() {
    return [...files.keys()]
        .filter(path => path.startsWith(`${KV_STORE_DIR}/`))
        .map(path => path.slice(KV_STORE_DIR.length + 1))
        .sort();
}

beforeEach(() => {
    files.clear();
});

describe("文件存储（Android 的 react-native-fs）", () => {
    it("插件名带空格和中文的附加信息，重启后读得回来", async () => {
        await createFilePersistence().write("MediaExtra.E2E 测试源 A", "saved");

        // 重启：新的实例
        expect(await createFilePersistence().read("MediaExtra.E2E 测试源 A")).toBe(
            "saved",
        );
        expect(names()).toEqual([
            "MediaExtra.E2E+20+E6+B5+8B+E8+AF+95+E6+BA+90+20A.json",
        ]);
    });

    it("不需要转义的 store 文件名不变", async () => {
        const persistence = createFilePersistence();
        await persistence.write("music.DownloadTasks", "tasks");
        await persistence.write("LocalSheet.favorite", "favorites");

        expect(names()).toEqual(["LocalSheet.favorite.json", "music.DownloadTasks.json"]);
        expect(await persistence.read("music.DownloadTasks")).toBe("tasks");
    });

    it("接过旧版本写在还原后名字上的内容，写入新文件后删掉旧文件和留下的临时文件", async () => {
        // 文件名带 % 的版本：内容和临时文件都落在还原后的名字上
        files.set(`${KV_STORE_DIR}/MediaExtra.E2E 测试源 A.json`, "last session");
        files.set(`${KV_STORE_DIR}/MediaExtra.E2E 测试源 A.json.tmp`, "last session");
        const persistence = createFilePersistence();

        expect(await persistence.read("MediaExtra.E2E 测试源 A")).toBe("last session");

        await persistence.write("MediaExtra.E2E 测试源 A", "now");
        expect(names()).toEqual([
            "MediaExtra.E2E+20+E6+B5+8B+E8+AF+95+E6+BA+90+20A.json",
        ]);
        expect(await createFilePersistence().read("MediaExtra.E2E 测试源 A")).toBe(
            "now",
        );
    });

    it("读不出来的旧文件当作没有，不报错也不删", async () => {
        // 按字面带 % 的名字：Android 上 readFile 会把路径还原，读不到它
        files.set(`${KV_STORE_DIR}/MediaExtra.a%20b.json`, "literal");
        const persistence = createFilePersistence();

        expect(await persistence.read("MediaExtra.a b")).toBeNull();
        await persistence.write("MediaExtra.a b", "now");
        expect(names()).toEqual(["MediaExtra.a%20b.json", "MediaExtra.a+20b.json"]);
        expect(await persistence.read("MediaExtra.a b")).toBe("now");
    });

    it("插件名带 % 的旧文件也读得回来", async () => {
        files.set(`${KV_STORE_DIR}/MediaExtra.100%音乐.json`, "percent");

        expect(await createFilePersistence().read("MediaExtra.100%音乐")).toBe(
            "percent",
        );
    });

    it("别的 store 的新文件不会被当成旧文件读走、删掉", async () => {
        const persistence = createFilePersistence();
        // "MediaExtra.a b" 的新文件名正好是 "MediaExtra.a+20b.json"
        await persistence.write("MediaExtra.a b", "a b");

        expect(await persistence.read("MediaExtra.a+20b")).toBeNull();
        await persistence.write("MediaExtra.a+20b", "a+20b");
        await persistence.remove("MediaExtra.a+20b");

        expect(await persistence.read("MediaExtra.a b")).toBe("a b");
    });

    it("插件名里的 / 和 .. 不会让读写、清理跑到别的目录", async () => {
        files.set(`${KV_STORE_DIR}/../shared_prefs.json`, "other app data");
        const persistence = createFilePersistence();

        expect(await persistence.read("MediaExtra./../../shared_prefs")).toBeNull();
        await persistence.write("MediaExtra./../../shared_prefs", "x");
        await persistence.remove("MediaExtra./../../shared_prefs");

        expect(files.get(`${KV_STORE_DIR}/../shared_prefs.json`)).toBe("other app data");
        expect(names()).toEqual(["../shared_prefs.json"]);
    });

    it("删除 store 时连旧文件一起删，不会在下次读到旧内容", async () => {
        files.set(`${KV_STORE_DIR}/MediaExtra.E2E 测试源 B.json`, "old");
        const persistence = createFilePersistence();
        await persistence.write("MediaExtra.E2E 测试源 B", "new");
        files.set(`${KV_STORE_DIR}/MediaExtra.E2E 测试源 B.json`, "old again");

        await persistence.remove("MediaExtra.E2E 测试源 B");

        expect(await persistence.read("MediaExtra.E2E 测试源 B")).toBeNull();
        expect(names()).toEqual([]);
    });
});

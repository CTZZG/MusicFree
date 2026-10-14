/**
 * 本地音乐库：同一个文件（文件名、大小、时长、标题、歌手、专辑都相同）只算一首。
 *
 * 应用只能凭这些信息认文件：系统音乐库和“选择文件夹”给的 content URI 不同，
 * 系统音乐库的 URI 也看不出真实路径，分不清“同一个文件的两条路径”和“两份
 * 完全一样的副本”，所以两种都只留一条。真实的 LocalMusicSheet 走完整导入，
 * 存储、系统音乐库、文件夹列表、元数据读取是内存里的假实现。
 */
export {};

type MockFile = {
    uri: string;
    displayName: string;
    size: number;
    title: string;
    duration: number;
};

const mockStorage = new Map<string, any>();
const mockExisting = new Set<string>();
const mockMeta = new Map<string, MockFile>();
let mockMediaStore: MockFile[] = [];
let mockFolder: MockFile[] = [];

function mockAutoStub(): any {
    const cache: Record<string | symbol, unknown> = {};
    return new Proxy(cache, {
        get(target, key) {
            if (key === "__esModule") {
                return true;
            }
            if (key === "then") {
                return undefined;
            }
            if (!(key in target)) {
                target[key] = key === "default" ? mockAutoStub() : jest.fn();
            }
            return target[key];
        },
    });
}

jest.mock("react-native-reanimated", () => ({
    __esModule: true,
    Easing: {
        out: () => () => 0,
        inOut: () => () => 0,
        bezier: () => () => 0,
        exp: () => 0,
    },
}));
jest.mock("@/utils/fileUtils", () => ({
    __esModule: true,
    addFileScheme: (path: string) =>
        path.startsWith("/") ? `file://${path}` : path,
    removeFileScheme: (path: string) => path.replace(/^file:\/\//, ""),
    getDirectory: (path: string) =>
        path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : path,
    getFileName: (path: string, withoutExt?: boolean) => {
        const name = path.slice(path.lastIndexOf("/") + 1);
        return withoutExt && name.includes(".")
            ? name.slice(0, name.lastIndexOf("."))
            : name;
    },
}));
let mockTokenCount = 0;
jest.mock("nanoid", () => ({
    nanoid: () => `token-${++mockTokenCount}`,
}));
jest.mock("@/utils/storage", () => ({
    __esModule: true,
    getStorage: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setStorage: jest.fn(async (key: string, value: unknown) => {
        mockStorage.set(key, JSON.parse(JSON.stringify(value)));
    }),
    setStorageStrict: jest.fn(async (key: string, value: unknown) => {
        mockStorage.set(key, JSON.parse(JSON.stringify(value)));
    }),
}));
jest.mock("@/native/storageUri", () => {
    const listing = (files: MockFile[]) =>
        files.map(file => ({
            uri: file.uri,
            kind: "content-uri",
            exists: true,
            displayName: file.displayName,
            size: file.size,
            modifiedAt: 1,
        }));
    return {
        __esModule: true,
        default: {
            exists: jest.fn(async (uri: string) => mockExisting.has(uri)),
            getMetadata: jest.fn(async (uri: string) => {
                const file = mockMeta.get(uri);
                if (!file || !mockExisting.has(uri)) {
                    throw new Error("missing");
                }
                return { displayName: file.displayName, size: file.size };
            }),
            queryAudioMediaStore: jest.fn(async () => listing(mockMediaStore)),
            listDirectoryDocuments: jest.fn(async () => listing(mockFolder)),
        },
    };
});
jest.mock("@/native/mp3Util", () => ({
    __esModule: true,
    default: {
        getMediaMeta: jest.fn(async (paths: string[]) =>
            paths.map(path => {
                const file = mockMeta.get(path);
                return file
                    ? {
                        title: file.title,
                        artist: "E2E Library",
                        album: "E2E Library Album",
                        duration: file.duration,
                    }
                    : null;
            }),
        ),
    },
}));
jest.mock("@/core/musicSheet", () => ({
    __esModule: true,
    default: { updateMusicItemReferences: jest.fn(async () => 0) },
}));
jest.mock("@/utils/mediaExtra", () => mockAutoStub());
jest.mock("@/core/localMusicArtworkManager", () => mockAutoStub());
jest.mock("@/utils/log", () => mockAutoStub());
jest.mock("react-native-fs", () => mockAutoStub());

const LocalMusicSheet = require("@/core/localMusicSheet").default;

const mediaUri = (id: number) => `content://media/external/audio/media/${id}`;
const folderUri = (name: string) =>
    `content://com.android.externalstorage.documents/tree/primary%3AMusic%2FE2E-Moved/document/primary%3AMusic%2FE2E-Moved%2F${name}`;

function audioFile(uri: string, title: string, overrides: Partial<MockFile> = {}): MockFile {
    const value: MockFile = {
        uri,
        displayName: `${title.replace(/ /g, "")}.mp3`,
        size: 80_000 + title.length,
        title,
        duration: 40_000 + title.length * 1000,
        ...overrides,
    };
    mockMeta.set(uri, value);
    mockExisting.add(uri);
    return value;
}

function remove(target: MockFile) {
    mockExisting.delete(target.uri);
    mockMediaStore = mockMediaStore.filter(item => item.uri !== target.uri);
}

function entries(title: string) {
    return LocalMusicSheet.getMusicList().filter(
        (item: IMusic.IMusicItem) => item.title === title,
    );
}

function localPath(item: IMusic.IMusicItem) {
    return item.$?.localPath;
}

beforeEach(async () => {
    mockStorage.clear();
    mockExisting.clear();
    mockMeta.clear();
    mockMediaStore = [];
    mockFolder = [];
    await LocalMusicSheet.setup();
});

describe("local music library: one entry per file", () => {
    it("keeps one entry when one scan finds two identical copies", async () => {
        mockMediaStore = [
            audioFile(mediaUri(1), "E2E Lib Three"),
            audioFile(mediaUri(2), "E2E Lib Three"),
        ];

        await LocalMusicSheet.importAndroidMediaStore();

        expect(entries("E2E Lib Three")).toHaveLength(1);
    });

    it("keeps one entry when identical copies appear after the file was imported", async () => {
        const original = audioFile(mediaUri(1), "E2E Lib One");
        mockMediaStore = [original];
        await LocalMusicSheet.importAndroidMediaStore();
        const [entry] = entries("E2E Lib One");

        mockMediaStore = [
            audioFile(mediaUri(2), "E2E Lib One"),
            audioFile(mediaUri(3), "E2E Lib One"),
            original,
        ];
        await LocalMusicSheet.importAndroidMediaStore();

        expect(entries("E2E Lib One")).toEqual([entry]);
    });

    it("still adds different files that share a title", async () => {
        mockMediaStore = [
            audioFile(mediaUri(1), "E2E Lib One"),
            audioFile(mediaUri(2), "E2E Lib One", { size: 99_000, duration: 90_000 }),
        ];

        await LocalMusicSheet.importAndroidMediaStore();

        expect(entries("E2E Lib One")).toHaveLength(2);
    });

    it("relinks the entry to a remaining copy after the linked copy is deleted", async () => {
        const first = audioFile(mediaUri(1), "E2E Lib One");
        const second = audioFile(mediaUri(2), "E2E Lib One");
        mockMediaStore = [first, second];
        await LocalMusicSheet.importAndroidMediaStore();
        const [entry] = entries("E2E Lib One");
        const linked = localPath(entry) === first.uri ? first : second;
        const remaining = linked === first ? second : first;

        remove(linked);
        await LocalMusicSheet.importAndroidMediaStore();

        const after = entries("E2E Lib One");
        expect(after).toHaveLength(1);
        expect(after[0].id).toBe(entry.id);
        expect(localPath(after[0])).toBe(remaining.uri);
    });

    it("does not add the same files again through the folder picker", async () => {
        mockMediaStore = [
            audioFile(mediaUri(1), "E2E Lib One"),
            audioFile(mediaUri(2), "E2E Lib Two"),
        ];
        await LocalMusicSheet.importAndroidMediaStore();
        const before = LocalMusicSheet.getMusicList();

        mockFolder = [
            audioFile(folderUri("E2ELibOne.mp3"), "E2E Lib One"),
            audioFile(folderUri("E2ELibTwo.mp3"), "E2E Lib Two"),
        ];
        await LocalMusicSheet.importAndroidDirectory("content://tree");

        expect(LocalMusicSheet.getMusicList()).toEqual(before);
    });

    it("does not add a third entry when older versions already left two", async () => {
        // 设备回归（Beta #138，修复前）：已有两条相同的 One 时，按文件认不出是哪一条，
        // 选择文件夹再导入时又加了第三条
        const legacy = [mediaUri(1), mediaUri(2)].map(uri => {
            const item = audioFile(uri, "E2E Lib One");
            return {
                id: `legacy-${uri.slice(-1)}`,
                platform: "本地",
                title: item.title,
                artist: "E2E Library",
                album: "E2E Library Album",
                duration: item.duration / 1000,
                $: { localPath: uri },
            };
        });
        mockStorage.set("local-music-sheet", legacy);
        await LocalMusicSheet.setup();
        expect(entries("E2E Lib One")).toHaveLength(2);

        mockFolder = [audioFile(folderUri("E2ELibOne.mp3"), "E2E Lib One")];
        await LocalMusicSheet.importAndroidDirectory("content://tree");

        expect(entries("E2E Lib One").map((item: IMusic.IMusicItem) => item.id))
            .toEqual(["legacy-1", "legacy-2"]);
    });

    it("does not add a renamed file again through the folder picker", async () => {
        // 系统音乐库里改名（FUSE 改名）保留同一行：URI 不变，文件名变了
        const two = audioFile(mediaUri(2), "E2E Lib Two");
        mockMediaStore = [two];
        await LocalMusicSheet.importAndroidMediaStore();
        const [entry] = entries("E2E Lib Two");

        mockMediaStore = [
            audioFile(two.uri, "E2E Lib Two", { displayName: "E2ELibTwoMoved.mp3" }),
        ];
        await LocalMusicSheet.importAndroidMediaStore();
        mockFolder = [
            audioFile(folderUri("E2ELibTwoMoved.mp3"), "E2E Lib Two", {
                displayName: "E2ELibTwoMoved.mp3",
            }),
        ];
        await LocalMusicSheet.importAndroidDirectory("content://tree");

        expect(entries("E2E Lib Two")).toHaveLength(1);
        expect(entries("E2E Lib Two")[0].id).toBe(entry.id);
    });
});

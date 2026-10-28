const mockConfig = new Map<string, unknown>();
const mockSheets = new Map<string, IMusic.IMusicItem[]>();
const mockMeta = new Map<string, string>();
let mockIndex: IMusic.IMusicSheetItemBase[] = [];
let mockNextId = 0;
const mockFlush = jest.fn(async () => true);
const mockPlugin = { name: "Demo", hash: "demo-hash", instance: { version: "1.0.0", srcUrl: "https://example.org/demo.js" } };
jest.mock("@/core/appConfig", () => ({ __esModule: true, default: { getConfig: (key: string) => mockConfig.get(key), setConfig: (key: string, value: unknown) => mockConfig.set(key, value) } }));
jest.mock("immer", () => jest.requireActual(require("path").join(process.cwd(), "node_modules/immer/dist/cjs/immer.cjs.development.js")));
jest.mock("nanoid", () => ({ nanoid: () => `restored-${++mockNextId}` }));
jest.mock("react-native-reanimated", () => ({ Easing: { exp: jest.fn(), out: jest.fn() } }));
jest.mock("@/utils/keyValueStore", () => ({ flushKeyValueStores: () => mockFlush() }));
jest.mock("@/utils/mediaUtils", () => ({ isSameMediaItem: (a: ICommon.IMediaBase, b: ICommon.IMediaBase) => a?.id === b?.id && a?.platform === b?.platform }));
jest.mock("../musicSheet/migrate.ts", () => ({ __esModule: true, default: async () => undefined, migrateV2: { migrate: () => undefined, done: () => undefined } }));
jest.mock("../musicSheet/storage.ts", () => ({ __esModule: true, default: {
    hydrateSheetIndex: async () => undefined, hydrateSheet: async () => undefined,
    getSheets: () => mockIndex,
    getMusicList: (id: string) => mockSheets.get(id) ?? [],
    getSheetMeta: (id: string, key: string) => mockMeta.get(`${id}:${key}`),
    getStarredSheets: () => [],
    setSheets: jest.fn(async (sheets: IMusic.IMusicSheetItemBase[]) => {
        mockIndex = sheets;
    }),
    setMusicList: async (id: string, songs: IMusic.IMusicItem[]) => {
        mockSheets.set(id, songs);
    },
    setSheetMeta: (id: string, key: string, value: string) => {
        mockMeta.set(`${id}:${key}`, value);
    },
    setStarredSheets: async () => undefined,
} }));
jest.mock("../localMusicSheet", () => ({ __esModule: true, default: {
    getMusicList: () => [], resumeMusicList: async () => ({ successCount: 0, failedCount: 0, skippedCount: 0, failureReasons: [] }),
} }));
jest.mock("../pluginManager", () => ({ __esModule: true, default: {
    getSortedPlugins: () => [mockPlugin], getEnabledPlugins: () => [mockPlugin],
    isPluginEnabled: () => true, getAlternativePluginName: () => null,
    getUserVariables: () => ({ token: "SYNTHETIC_CONFIGURATION" }),
    getByName: () => mockPlugin, setPluginOrder: jest.fn(), setPluginEnabled: jest.fn(),
    setUserVariables: jest.fn(), getAlternativePluginNameFor: () => null,
} }));
jest.mock("@/utils/remoteInstallUrl", () => ({ validateRemoteInstallUrl: () => ({ ok: true }) }));

import Backup from "../backup";
import MusicSheet from "../musicSheet";
import Config from "../appConfig";
import { ResumeMode, SortType, localPluginPlatform } from "@/constants/commonConst";
import storage from "../musicSheet/storage";

const favorite = { id: "favorite", platform: localPluginPlatform, title: "Favorite" };
const song = { id: "track", platform: "Demo", title: "Track", artist: "Artist", album: "Album", duration: 60, artwork: "https://example.org/song.png" };
const source = { id: "original", platform: localPluginPlatform, title: "Commute", description: "Saved description", coverImg: "file:///music/cover.png", createAt: 1234 };

async function setup(sheets: IMusic.IMusicSheetItemBase[]) {
    mockIndex = sheets.map(sheet => ({ ...sheet }));
    MusicSheet.injectDependencies(Config);
    await MusicSheet.setup();
}
beforeEach(async () => {
    jest.clearAllMocks(); mockConfig.clear(); mockSheets.clear(); mockMeta.clear(); mockNextId = 0;
    mockFlush.mockResolvedValue(true);
    mockSheets.set("original", [song]); mockMeta.set("original:sort", SortType.Title);
    await setup([favorite, source]);
});

it("round-trips metadata, sort, groups, pins, home order and plugin variables", async () => {
    mockConfig.set("library.playlistOrganization", { pinnedIds: ["original"], groupBySheetId: { original: "Work" } });
    mockConfig.set("theme.homeSectionOrder", ["shortcuts", "recent", "continue", "discovery"]);
    mockConfig.set("theme.hideHomeDiscovery", true);
    mockConfig.set("library.playlistView", "list");
    const raw = Backup.backup();
    const json = JSON.parse(raw);
    expect(json.version).toBe(3);
    expect(json.pluginBackupV2.userVariables.Demo.token).toBe("SYNTHETIC_CONFIGURATION");
    mockConfig.clear(); mockSheets.clear(); mockMeta.clear();
    await setup([favorite]);
    const report = await Backup.resume(raw, ResumeMode.Append);
    expect(report.musicSheets).toMatchObject({ successCount: 2, failedCount: 0 });
    expect(report.persisted).toBe(true);
    const restored = MusicSheet.getSheets().find(sheet => sheet.title === "Commute")!;
    expect(restored.id).not.toBe(source.id);
    expect(restored).toMatchObject({ description: source.description, coverImg: source.coverImg, createAt: 1234 });
    expect(MusicSheet.getSortedMusicListBySheetId(restored.id).musicList).toEqual([expect.objectContaining({ id: song.id })]);
    expect(mockMeta.get(`${restored.id}:sort`)).toBe(SortType.Title);
    expect(mockConfig.get("library.playlistOrganization")).toEqual({ pinnedIds: [restored.id], groupBySheetId: { [restored.id]: "Work" } });
    expect(mockConfig.get("theme.homeSectionOrder")).toEqual(["shortcuts", "recent", "continue", "discovery"]);
    expect(mockConfig.get("theme.hideHomeDiscovery")).toBe(true);
    expect(mockConfig.get("library.playlistView")).toBe("list");
    expect(mockFlush).toHaveBeenCalledTimes(1);
});

it("merges into the matching local ID while preserving local custom metadata and groups", async () => {
    mockConfig.set("library.playlistOrganization", { pinnedIds: ["local"], groupBySheetId: { local: "Local" } });
    await setup([favorite, { ...source, id: "local", coverImg: "file:///local.png", description: "Local description" }]);
    const report = await Backup.resume({ version: 3, musicSheets: [{ ...source, musicList: [song] }], preferences: {
        playlistOrganization: { pinnedIds: [source.id], groupBySheetId: { [source.id]: "Incoming" } },
    } }, ResumeMode.Overwrite);
    expect(report.musicSheets.successCount).toBe(1);
    expect(MusicSheet.getSheets()).toHaveLength(2);
    expect(MusicSheet.getSheets()[1]).toMatchObject({ id: "local", description: "Local description", coverImg: "file:///local.png" });
    expect(mockConfig.get("library.playlistOrganization")).toEqual({ pinnedIds: ["local"], groupBySheetId: { local: "Local" } });
});

it("keeps existing settings when restoring an old unversioned backup", async () => {
    mockConfig.set("theme.homeSectionOrder", ["recent", "shortcuts", "continue", "discovery"]);
    const report = await Backup.resume({ musicSheets: [{ ...source, musicList: [song] }] });
    expect(report.preferences).toBeUndefined();
    expect(mockConfig.get("theme.homeSectionOrder")).toEqual(["recent", "shortcuts", "continue", "discovery"]);
});

it.each([null, [], { version: 999, musicSheets: [source] }])("rejects unsupported roots before mutating data: %s", async invalid => {
    const previous = JSON.stringify(MusicSheet.getSheets());
    await expect(Backup.resume(JSON.stringify(invalid))).rejects.toThrow();
    expect(JSON.stringify(MusicSheet.getSheets())).toBe(previous);
    expect(mockFlush).not.toHaveBeenCalled();
});

it("reports failed sheets and does not attach their grouping to another ID", async () => {
    jest.mocked(storage.setSheets).mockRejectedValueOnce(new Error("disk failure"));
    const report = await Backup.resume({ version: 3, musicSheets: [{ ...source, musicList: [song] }], preferences: {
        playlistOrganization: { pinnedIds: [source.id], groupBySheetId: { [source.id]: "Lost" } },
    } });
    expect(report.musicSheets).toMatchObject({ successCount: 0, failedCount: 1 });
    expect(mockConfig.get("library.playlistOrganization")).toEqual({ pinnedIds: [], groupBySheetId: {} });
});

it("does not restore arbitrary app configuration and reports persistence failure", async () => {
    mockFlush.mockResolvedValueOnce(false);
    const report = await Backup.resume({ version: 3, preferences: { settings: {
        "basic.autoPlayWhenAppStart": true, "webdav.url": "http://example.org", "theme.hideHomeDiscovery": true,
    } } });
    expect(mockConfig.get("basic.autoPlayWhenAppStart")).toBeUndefined();
    expect(mockConfig.get("webdav.url")).toBeUndefined();
    expect(mockConfig.get("theme.hideHomeDiscovery")).toBe(true);
    expect(report.persisted).toBe(false);
});


it("restores custom metadata independently of the returned report", async () => {
    await MusicSheet.resumeSheets([{ ...source, musicList: [song] }], ResumeMode.Append);
    const restored = MusicSheet.getSheets().find(sheet => sheet.id !== source.id && sheet.title === source.title)!;
    expect(restored.coverImg).toBe(source.coverImg);
    expect(restored.description).toBe(source.description);
});

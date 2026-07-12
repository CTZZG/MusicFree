jest.mock("react-native-reanimated", () => ({
    Easing: {
        exp: jest.fn(),
        out: jest.fn((easing: unknown) => easing),
    },
}));

jest.mock("nanoid", () => ({
    nanoid: jest.fn(() => "generated-sheet-id"),
}));

jest.mock("immer", () => ({
    Immer: class MockImmer {
        produce = <T>(base: T, recipe: (draft: T) => T | void) => {
            const draft = JSON.parse(JSON.stringify(base)) as T;
            return recipe(draft) ?? draft;
        };
    },
}));

jest.mock("@/utils/mediaUtils", () => ({
    isSameMediaItem: jest.fn(
        (left: ICommon.IMediaBase, right: ICommon.IMediaBase) =>
            `${left.platform}` === `${right.platform}` &&
            `${left.id}` === `${right.id}`,
    ),
}));

jest.mock("../migrate.ts", () => ({
    __esModule: true,
    default: jest.fn(async () => undefined),
    migrateV2: {
        migrate: jest.fn(),
        done: jest.fn(),
    },
}));

jest.mock("../storage.ts", () => ({
    __esModule: true,
    default: {
        getSheets: jest.fn(),
        setSheets: jest.fn(),
        getMusicList: jest.fn(),
        setMusicList: jest.fn(),
        removeMusicList: jest.fn(),
        getSheetMeta: jest.fn(),
        setSheetMeta: jest.fn(),
        getStarredSheets: jest.fn(),
        setStarredSheets: jest.fn(),
    },
}));

import { SortType, localPluginPlatform } from "@/constants/commonConst";
import MusicSheet from "../index";
import storage from "../storage";

const favorite = {
    id: "favorite",
    platform: localPluginPlatform,
    title: "Favorite",
    worksNum: 0,
} as IMusic.IMusicSheetItemBase;
const sheetA = {
    id: "sheet-a",
    platform: localPluginPlatform,
    title: "A",
    coverImg: "file://custom-cover.jpg",
    worksNum: 2,
} as IMusic.IMusicSheetItemBase;
const sheetB = {
    id: "sheet-b",
    platform: localPluginPlatform,
    title: "B",
    worksNum: 0,
} as IMusic.IMusicSheetItemBase;
const songA = {
    id: "song-a",
    platform: "test",
    title: "Song A",
    artist: "Artist",
    album: "Album",
    artwork: "file://song-a.jpg",
} as IMusic.IMusicItem;
const songB = {
    ...songA,
    id: "song-b",
    title: "Song B",
    artwork: "file://song-b.jpg",
} as IMusic.IMusicItem;

describe("MusicSheet transactional updates", () => {
    const mockedStorage = jest.mocked(storage);
    const setSheetsMock = storage.setSheets as jest.Mock;
    const setMusicListMock = storage.setMusicList as jest.Mock;
    const setStarredSheetsMock = storage.setStarredSheets as jest.Mock;

    beforeEach(async () => {
        jest.clearAllMocks();
        mockedStorage.getSheets.mockReturnValue([
            { ...favorite },
            { ...sheetA },
            { ...sheetB },
        ]);
        mockedStorage.getMusicList.mockImplementation(sheetId =>
            sheetId === sheetA.id ? [{ ...songA }, { ...songB }] : [],
        );
        mockedStorage.getSheetMeta.mockReturnValue(SortType.None);
        mockedStorage.getStarredSheets.mockReturnValue([]);
        setSheetsMock.mockResolvedValue(undefined);
        setMusicListMock.mockResolvedValue(undefined);
        setStarredSheetsMock.mockResolvedValue(undefined);
        await MusicSheet.setup();
        jest.clearAllMocks();
    });

    it("commits the new index before updating memory and deleting old data", async () => {
        let resolveWrite!: () => void;
        setSheetsMock.mockReturnValueOnce(
            new Promise<void>(resolve => {
                resolveWrite = resolve;
            }),
        );

        const update = MusicSheet.setSortedSheets([{ ...sheetB }]);

        expect(MusicSheet.getSheets().map(sheet => sheet.id)).toEqual([
            favorite.id,
            sheetA.id,
            sheetB.id,
        ]);
        expect(mockedStorage.removeMusicList).not.toHaveBeenCalled();

        resolveWrite();
        await update;

        expect(MusicSheet.getSheets().map(sheet => sheet.id)).toEqual([
            favorite.id,
            sheetB.id,
        ]);
        expect(mockedStorage.removeMusicList).toHaveBeenCalledWith(sheetA.id);
        expect(setSheetsMock.mock.invocationCallOrder[0]).toBeLessThan(
            mockedStorage.removeMusicList.mock.invocationCallOrder[0],
        );
    });

    it("keeps memory and deleted sheet data untouched when index persistence fails", async () => {
        setSheetsMock.mockRejectedValueOnce(new Error("disk full"));

        await expect(
            MusicSheet.setSortedSheets([{ ...sheetB }]),
        ).rejects.toThrow("disk full");

        expect(MusicSheet.getSheets().map(sheet => sheet.id)).toEqual([
            favorite.id,
            sheetA.id,
            sheetB.id,
        ]);
        expect(mockedStorage.removeMusicList).not.toHaveBeenCalled();
    });

    it("updates worksNum while preserving a custom local cover", async () => {
        await MusicSheet.removeMusic(sheetA.id, songA);

        const persistedSheets = setSheetsMock.mock.calls.at(-1)?.[0];
        expect(persistedSheets?.find(sheet => sheet.id === sheetA.id)).toMatchObject({
            coverImg: sheetA.coverImg,
            worksNum: 1,
        });
        expect(mockedStorage.setMusicList).toHaveBeenCalledWith(
            sheetA.id,
            [expect.objectContaining({ id: songB.id })],
        );
    });

    it("updates starred memory only after persistence succeeds", async () => {
        const starred = [{ ...sheetA, musicList: [] }] as IMusic.IMusicSheetItem[];
        setStarredSheetsMock.mockRejectedValueOnce(
            new Error("disk full"),
        );

        await expect(MusicSheet.setStarredMusicSheets(starred)).rejects.toThrow(
            "disk full",
        );
        expect(MusicSheet.getStarredSheets()).toEqual([]);
    });
});

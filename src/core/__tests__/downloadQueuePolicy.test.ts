import {
    filterQueueableDownloadItems,
    shouldQueueDownloadTask,
} from "../downloadQueuePolicy";

interface TestMusic {
    id: string;
    platform: string;
    title?: string;
}

const item = (id: string, platform = "test"): TestMusic => ({
    id,
    platform,
});

const getKey = (musicItem: ICommon.IMediaBase) =>
    `${musicItem.platform}@${musicItem.id}`;

describe("download queue policy", () => {
    it("queues a remote item when no matching task or local copy exists", () => {
        expect(
            shouldQueueDownloadTask(item("a"), {
                activeTaskKeys: new Set(),
                localMusicItems: [],
                getKey,
            }),
        ).toBe(true);
    });

    it("blocks an item that already has an active download task", () => {
        const musicItem = item("a");

        expect(
            shouldQueueDownloadTask(musicItem, {
                activeTaskKeys: new Set([getKey(musicItem)]),
                localMusicItems: [],
                getKey,
            }),
        ).toBe(false);
    });

    it("blocks an item that already has a downloaded local copy", () => {
        expect(
            shouldQueueDownloadTask(item("1001"), {
                activeTaskKeys: new Set(),
                localMusicItems: [
                    {
                        ...item("1001"),
                        title: "Downloaded copy",
                    },
                ],
                getKey,
            }),
        ).toBe(false);
    });

    it("ignores unrelated local copies", () => {
        expect(
            shouldQueueDownloadTask(item("a"), {
                activeTaskKeys: new Set(),
                localMusicItems: [item("b")],
                getKey,
            }),
        ).toBe(true);
    });

    it("rejects empty candidates", () => {
        expect(
            shouldQueueDownloadTask(null, {
                activeTaskKeys: new Set(),
                localMusicItems: [],
                getKey,
            }),
        ).toBe(false);
    });

    it("filters batch duplicates after the first accepted item", () => {
        const first = item("a");
        const duplicate = {
            ...item("a"),
            title: "Duplicate candidate",
        };
        const second = item("b");

        expect(
            filterQueueableDownloadItems([first, duplicate, second], {
                activeTaskKeys: new Set(),
                localMusicItems: [],
                getKey,
            }),
        ).toEqual([first, second]);
    });

    it("does not mutate the caller active-task set while filtering a batch", () => {
        const activeTaskKeys = new Set<string>();

        filterQueueableDownloadItems([item("a")], {
            activeTaskKeys,
            localMusicItems: [],
            getKey,
        });

        expect(activeTaskKeys.size).toBe(0);
    });
});

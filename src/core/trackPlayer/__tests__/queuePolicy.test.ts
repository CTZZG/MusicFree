import { MusicRepeatMode } from "@/constants/trackPlayerConst";
import {
    findNextPlayableQueueItem,
    getSafeUnresolvedQueueUrl,
    getWrappedQueueItem,
    replaceQueueItemByIdentity,
    resolvePreviousQueueItem,
    resolvePreparedNextItem,
    resolvePreparedNextItems,
} from "../queuePolicy";

interface TestMusic {
    id: string;
    platform: string;
    url?: string | null;
    localPath?: string | null;
    title?: string;
}

const sameItem = (a?: TestMusic | null, b?: TestMusic | null) =>
    !!a && !!b && a.platform === b.platform && a.id === b.id;

const item = (id: string): TestMusic => ({
    id,
    platform: "test",
});

describe("track player queue policy", () => {
    it.each([
        ["https://cdn.example.test/song.mp3", ""],
        ["http://media.example.test/song.mp3", ""],
        [`${"java"}script:alert(1)`, ""],
        [
            "file:///storage/emulated/0/Music/song.mp3",
            "file:///storage/emulated/0/Music/song.mp3",
        ],
        [
            " content://media/external/audio/media/42 ",
            "content://media/external/audio/media/42",
        ],
        ["/storage/emulated/0/Music/song.mp3", ""],
    ])("keeps unresolved backend queue URLs local: %s", (url, expected) => {
        expect(getSafeUnresolvedQueueUrl(url)).toBe(expected);
    });

    it("wraps positive and negative queue indices", () => {
        const queue = [item("a"), item("b"), item("c")];

        expect(getWrappedQueueItem(queue, 3)).toEqual(item("a"));
        expect(getWrappedQueueItem(queue, -1)).toEqual(item("c"));
        expect(getWrappedQueueItem([], 0)).toBeNull();
    });

    it("does not prepare the current item in single repeat mode", () => {
        const current = item("a");

        expect(
            resolvePreparedNextItem({
                currentItem: current,
                queue: [current, item("b")],
                currentIndex: 0,
                repeatMode: MusicRepeatMode.SINGLE,
                playLaterQueueLength: 0,
                isSameItem: sameItem,
                isSkipped: () => false,
            }),
        ).toBeNull();
    });

    it("blocks native prepared-next while play-later has priority", () => {
        const current = item("a");

        expect(
            resolvePreparedNextItem({
                currentItem: current,
                queue: [current, item("b")],
                currentIndex: 0,
                repeatMode: MusicRepeatMode.QUEUE,
                playLaterQueueLength: 1,
                isSameItem: sameItem,
                isSkipped: () => false,
            }),
        ).toBeNull();
    });

    it("prepares the wrapped first item at the end of a looping queue", () => {
        // 预载必须和 findNextPlayableQueueItem 的推进结果一致：列表循环在队尾
        // 会绕回队首，如果这里不预载，原生 runway 每绕一圈就空一次。
        const queue = [item("a"), item("b"), item("c")];

        expect(
            resolvePreparedNextItem({
                currentItem: queue[2],
                queue,
                currentIndex: 2,
                repeatMode: MusicRepeatMode.QUEUE,
                playLaterQueueLength: 0,
                isSameItem: sameItem,
                isSkipped: () => false,
            }),
        ).toBe(queue[0]);
    });

    it("still refuses to prepare anything in single repeat mode", () => {
        // 单曲循环必须由 JS 重新加载，不能让 mpv 无缝重复同一首。
        const queue = [item("a"), item("b")];

        expect(
            resolvePreparedNextItem({
                currentItem: queue[1],
                queue,
                currentIndex: 1,
                repeatMode: MusicRepeatMode.SINGLE,
                playLaterQueueLength: 0,
                isSameItem: sameItem,
                isSkipped: () => false,
            }),
        ).toBeNull();
    });

    it("skips disliked items and never returns the current duplicate", () => {
        const current = item("a");
        const duplicateCurrent = item("a");
        const disliked = item("b");
        const playable = item("c");
        const queue = [current, duplicateCurrent, disliked, playable];

        expect(
            findNextPlayableQueueItem(queue, 0, current, {
                isSameItem: sameItem,
                isSkipped: candidate => candidate.id === disliked.id,
            }),
        ).toBe(playable);
    });

    it("returns null when every candidate is skipped or the current item", () => {
        const current = item("a");
        const queue = [current, item("b")];

        expect(
            resolvePreparedNextItem({
                currentItem: current,
                queue,
                currentIndex: 0,
                repeatMode: MusicRepeatMode.QUEUE,
                playLaterQueueLength: 0,
                isSameItem: sameItem,
                isSkipped: candidate => candidate.id === "b",
            }),
        ).toBeNull();
    });

    it("resolves several upcoming items in playback order, chaining off each pick", () => {
        const queue = [item("a"), item("b"), item("c"), item("d")];

        expect(
            resolvePreparedNextItems({
                currentItem: queue[0],
                queue,
                currentIndex: 0,
                repeatMode: MusicRepeatMode.QUEUE,
                playLaterQueueLength: 0,
                isSameItem: sameItem,
                isSkipped: () => false,
                count: 3,
            }),
        ).toEqual([queue[1], queue[2], queue[3]]);
    });

    it("wraps around the loop and can pick the same track again as a later item", () => {
        // 循环队列里，A 播完 B 之后，B 播完理应再绕回 A——不能因为 A 曾经是
        // 起点就被永久排除在后续预备之外。
        const queue = [item("a"), item("b")];

        expect(
            resolvePreparedNextItems({
                currentItem: queue[0],
                queue,
                currentIndex: 0,
                repeatMode: MusicRepeatMode.QUEUE,
                playLaterQueueLength: 0,
                isSameItem: sameItem,
                isSkipped: () => false,
                count: 3,
            }),
        ).toEqual([queue[1], queue[0], queue[1]]);
    });

    it("stops early when fewer playable items remain than requested", () => {
        const disliked = item("b");
        const queue = [item("a"), disliked];

        expect(
            resolvePreparedNextItems({
                currentItem: queue[0],
                queue,
                currentIndex: 0,
                repeatMode: MusicRepeatMode.QUEUE,
                playLaterQueueLength: 0,
                isSameItem: sameItem,
                isSkipped: candidate => candidate.id === disliked.id,
                count: 5,
            }),
        ).toEqual([]);
    });

    it("returns nothing for single-repeat, play-later priority, or a non-positive count", () => {
        const current = item("a");
        const queue = [current, item("b")];
        const base = {
            currentItem: current,
            queue,
            currentIndex: 0,
            playLaterQueueLength: 0,
            isSameItem: sameItem,
            isSkipped: () => false,
            count: 2,
        };

        expect(
            resolvePreparedNextItems({
                ...base,
                repeatMode: MusicRepeatMode.SINGLE,
            }),
        ).toEqual([]);
        expect(
            resolvePreparedNextItems({
                ...base,
                repeatMode: MusicRepeatMode.QUEUE,
                playLaterQueueLength: 1,
            }),
        ).toEqual([]);
        expect(
            resolvePreparedNextItems({
                ...base,
                repeatMode: MusicRepeatMode.QUEUE,
                count: 0,
            }),
        ).toEqual([]);
    });

    it("agrees with the single-item resolver on the first pick", () => {
        const queue = [item("a"), item("b"), item("c")];
        const options = {
            currentItem: queue[2],
            queue,
            currentIndex: 2,
            repeatMode: MusicRepeatMode.QUEUE,
            playLaterQueueLength: 0,
            isSameItem: sameItem,
            isSkipped: () => false,
        };

        expect(resolvePreparedNextItems({ ...options, count: 1 })).toEqual([
            resolvePreparedNextItem(options),
        ]);
    });

    it("resolves the previous queue item with wrapping", () => {
        const queue = [item("a"), item("b"), item("c")];

        expect(resolvePreviousQueueItem(queue, 0)).toEqual({
            index: 2,
            item: queue[2],
        });
        expect(resolvePreviousQueueItem(queue, 2)).toEqual({
            index: 1,
            item: queue[1],
        });
    });

    it("resolves the only queue item as previous for restart semantics", () => {
        const queue = [item("a")];

        expect(resolvePreviousQueueItem(queue, 0)).toEqual({
            index: 0,
            item: queue[0],
        });
    });

    it("does not resolve previous when queue or current index is invalid", () => {
        expect(resolvePreviousQueueItem([], 0)).toBeNull();
        expect(resolvePreviousQueueItem([item("a")], -1)).toBeNull();
    });

    it("replaces an existing queue item with fresh source fields", () => {
        const staleLocal = {
            ...item("a"),
            title: "Old Song",
            url: "content://media/external/audio/media/1000008551",
            localPath: "content://media/external/audio/media/1000008551",
        };
        const freshRemote = {
            ...item("a"),
            title: "Fresh Song",
            url: "https://cdn.example.test/fresh.mp3",
            localPath: null,
        };
        const untouched = item("b");

        const result = replaceQueueItemByIdentity(
            [untouched, staleLocal],
            freshRemote,
            sameItem,
        );

        expect(result).toMatchObject({
            index: 1,
            replaced: true,
        });
        expect(result.queue).toEqual([untouched, freshRemote]);
    });

    it("does not report replacement for the same queue object", () => {
        const current = item("a");

        const result = replaceQueueItemByIdentity([current], current, sameItem);

        expect(result).toMatchObject({
            index: 0,
            replaced: false,
        });
        expect(result.queue).toEqual([current]);
    });
});

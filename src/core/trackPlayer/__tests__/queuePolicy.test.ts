import { MusicRepeatMode } from "@/constants/trackPlayerConst";
import {
    findNextPlayableQueueItem,
    getWrappedQueueItem,
    replaceQueueItemByIdentity,
    resolvePreviousQueueItem,
    resolvePreparedNextItem,
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

    it("does not prepare a wrapped queue item at the end", () => {
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

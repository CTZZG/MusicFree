import {
    hasSameQueueOrder,
    moveQueueItem,
    moveQueueItemAfterCurrent,
    restoreQueueSnapshot,
} from "../queueEditing";

const same = (left: { id: string }, right: { id: string }) => left.id === right.id;
const [a, b, c, d] = ["a", "b", "c", "d"].map(id => ({ id }));
const queue = [a, b, c, d];
const ids = (items: readonly { id: string }[]) => items.map(item => item.id);

it.each([
    [a, 3, ["b", "c", "d", "a"]],
    [d, 0, ["d", "a", "b", "c"]],
    [b, -10, ["b", "a", "c", "d"]],
    [b, 20, ["a", "c", "d", "b"]],
])("moves by identity while preserving every entry", (item, destination, expected) => {
    expect(ids(moveQueueItem(queue, item, destination, same))).toEqual(expected);
    expect(ids(queue)).toEqual(["a", "b", "c", "d"]);
});

it("returns the original queue for invalid requests and no-ops", () => {
    expect(moveQueueItem(queue, { id: "missing" }, 0, same)).toBe(queue);
    expect(moveQueueItem(queue, a, 0, same)).toBe(queue);
    expect(moveQueueItem(queue, a, NaN, same)).toBe(queue);
});

it.each([
    [a, c, ["b", "c", "a", "d"]],
    [d, b, ["a", "b", "d", "c"]],
    [c, b, ["a", "b", "c", "d"]],
    [d, null, ["d", "a", "b", "c"]],
])("moves to next without shifting the current song identity", (item, current, expected) => {
    expect(ids(moveQueueItemAfterCurrent(queue, item, current, same))).toEqual(expected);
});

it("does not move the currently playing entry to next", () => {
    expect(moveQueueItemAfterCurrent(queue, b, { id: "b" }, same)).toBe(queue);
});

it("detects structural edits while allowing source and metadata hydration", () => {
    expect(hasSameQueueOrder(queue, queue.map(item => ({ ...item, url: "hydrated" })), same)).toBe(true);
    expect(hasSameQueueOrder(queue, [a, c, b, d], same)).toBe(false);
    expect(hasSameQueueOrder(queue, [a, b, c], same)).toBe(false);
});

it("undo retains hydrated fields for present entries and restores missing entries", () => {
    const hydrated = { id: "b", url: "fresh", title: "Updated title" };
    const restored = restoreQueueSnapshot(queue, [a, hydrated, d], item => item.id);
    expect(ids(restored)).toEqual(["a", "b", "c", "d"]);
    expect(restored[1]).toBe(hydrated);
    expect(restored[2]).toBe(c);
});

const mockStores = new Map<string, Map<string, string>>();

jest.mock("@/utils/getOrCreateMMKV", () => ({
    __esModule: true,
    hydrateKeyValueStore: jest.fn(async () => undefined),
    default: jest.fn((namespace: string) => {
        if (!mockStores.has(namespace)) {
            mockStores.set(namespace, new Map());
        }
        const store = mockStores.get(namespace)!;
        return {
            getString: jest.fn((key: string) => store.get(key)),
            set: jest.fn((key: string, value: string) => {
                store.set(key, value);
            }),
            delete: jest.fn((key: string) => {
                store.delete(key);
            }),
            clearAll: jest.fn(() => {
                store.clear();
            }),
        };
    }),
}));

jest.mock("@/utils/mediaUtils", () => ({
    getMediaUniqueKey: jest.fn(
        (mediaItem: {platform?: string; id?: string}) =>
            `${mediaItem.platform}@${mediaItem.id}`,
    ),
}));

import {
    getMediaExtraObserverKey,
    getMediaExtra,
    getMediaExtraProperty,
    normalizeMediaExtraProperties,
    patchMediaExtra,
} from "../mediaExtra";

describe("mediaExtra storage normalization", () => {
    const mediaItem = {
        id: "track-1",
        platform: "test",
        title: "Track",
    } as IMusic.IMusicItem;

    beforeEach(() => {
        mockStores.clear();
    });

    function setRawMediaExtra(raw: string) {
        mockStores.set("MediaExtra.test", new Map([["track-1", raw]]));
    }

    it("accepts only object media-extra payloads", () => {
        expect(normalizeMediaExtraProperties({ downloaded: true })).toEqual({
            downloaded: true,
        });
        expect(normalizeMediaExtraProperties(null)).toBeNull();
        expect(normalizeMediaExtraProperties("bad")).toBeNull();
        expect(normalizeMediaExtraProperties(0)).toBeNull();
        expect(normalizeMediaExtraProperties([])).toBeNull();
    });

    it("builds observer keys only for valid media items", () => {
        expect(getMediaExtraObserverKey(mediaItem)).toBe("test@track-1");
        expect(getMediaExtraObserverKey(null)).toBeNull();
        expect(getMediaExtraObserverKey(undefined)).toBeNull();
        expect(
            getMediaExtraObserverKey({ id: "track-1" } as IMusic.IMusicItem),
        ).toBeNull();
        expect(
            getMediaExtraObserverKey({ platform: "test" } as IMusic.IMusicItem),
        ).toBeNull();
    });

    it("ignores parsed non-object media-extra values", () => {
        setRawMediaExtra("\"bad\"");

        expect(getMediaExtra(mediaItem)).toBeNull();
        expect(getMediaExtraProperty(mediaItem, "downloaded")).toBeNull();
    });

    it("does not spread corrupted stored values when patching media extra", () => {
        setRawMediaExtra("[\"bad\"]");

        expect(
            patchMediaExtra(mediaItem, {
                downloaded: true,
            }),
        ).toEqual({
            downloaded: true,
        });
        expect(
            JSON.parse(mockStores.get("MediaExtra.test")!.get("track-1")!),
        ).toEqual({
            downloaded: true,
        });
    });
});

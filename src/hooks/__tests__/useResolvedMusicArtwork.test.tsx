import React from "react";
import { act, create, ReactTestRenderer } from "react-test-renderer";

jest.mock("@/pages/musicDetail/artworkResolver", () => ({
    getCachedMusicArtwork: jest.fn(() => undefined),
    getMusicArtworkLookupKey: jest.fn(
        (item: IMusic.IMusicItem) =>
            `${item.platform}@${item.id}|${item.title}|${item.artist}`,
    ),
    isUsableMusicDetailArtwork: jest.fn(
        (value: unknown) =>
            typeof value === "string" && /^https?:/i.test(value.trim()),
    ),
    resolveMusicDetailArtwork: jest.fn(),
}));

import {
    getCachedMusicArtwork,
    resolveMusicDetailArtwork,
} from "@/pages/musicDetail/artworkResolver";
import useResolvedMusicArtwork from "../useResolvedMusicArtwork";

const mockGetCachedMusicArtwork = getCachedMusicArtwork as jest.MockedFunction<
    typeof getCachedMusicArtwork
>;
const mockResolveMusicDetailArtwork =
    resolveMusicDetailArtwork as jest.MockedFunction<
        typeof resolveMusicDetailArtwork
    >;

function music(overrides: Partial<IMusic.IMusicItem> = {}) {
    return {
        id: "song-1",
        platform: "local",
        title: "Alice Deejay",
        artist: "Back In My Life",
        album: "",
        duration: 208,
        artwork: "",
        ...overrides,
    } as IMusic.IMusicItem;
}

describe("useResolvedMusicArtwork", () => {
    let renderer: ReactTestRenderer | undefined;
    let latestArtwork: string | undefined;

    function Probe({ item }: {item: IMusic.IMusicItem | null}) {
        latestArtwork = useResolvedMusicArtwork(item);
        return null;
    }

    beforeEach(() => {
        latestArtwork = undefined;
        mockGetCachedMusicArtwork.mockReturnValue(undefined);
        mockResolveMusicDetailArtwork.mockReset();
    });

    afterEach(() => {
        act(() => {
            renderer?.unmount();
        });
        renderer = undefined;
    });

    it("updates a visible consumer when the shared resolver finds artwork", async () => {
        mockResolveMusicDetailArtwork.mockResolvedValue(
            "https://img/itunes.jpg",
        );

        await act(async () => {
            renderer = create(<Probe item={music()} />);
        });

        expect(latestArtwork).toBe("https://img/itunes.jpg");
    });

    it("ignores an old song result after the visible song changes", async () => {
        let resolveFirst: (value: string) => void = () => undefined;
        let resolveSecond: (value: string) => void = () => undefined;
        mockResolveMusicDetailArtwork
            .mockReturnValueOnce(
                new Promise(resolve => {
                    resolveFirst = resolve;
                }),
            )
            .mockReturnValueOnce(
                new Promise(resolve => {
                    resolveSecond = resolve;
                }),
            );

        act(() => {
            renderer = create(<Probe item={music()} />);
        });
        act(() => {
            renderer!.update(
                <Probe item={music({ id: "song-2", title: "Next Song" })} />,
            );
        });
        await act(async () => {
            resolveFirst("https://img/old.jpg");
            await Promise.resolve();
        });
        expect(latestArtwork).toBeUndefined();

        await act(async () => {
            resolveSecond("https://img/new.jpg");
            await Promise.resolve();
        });
        expect(latestArtwork).toBe("https://img/new.jpg");
    });
});

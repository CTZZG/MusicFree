jest.mock("../pluginManager", () => ({
    __esModule: true,
    default: { getByMedia: jest.fn() },
}));
import pluginManager from "../pluginManager";
import {
    formatMusicShareMessage,
    SHARE_DETAIL_TIMEOUT_MS,
} from "../musicShare";
const song = {
    id: "1",
    platform: "source",
    title: "Song",
    artist: "Artist",
    url: "https://secret/audio?token=private",
} as IMusic.IMusicItem;
afterEach(() => jest.useRealTimers());

it("bounds a missing plugin response and ignores a public URL arriving after fallback", async () => {
    jest.useFakeTimers();
    let resolve!: (url: string) => void;
    (pluginManager.getByMedia as jest.Mock).mockReturnValue({
        methods: {
            getMusicDetailPageUrl: () =>
                new Promise<string>(done => {
                    resolve = done;
                }),
        },
    });
    const result = formatMusicShareMessage(song);
    await Promise.resolve();
    jest.advanceTimersByTime(SHARE_DETAIL_TIMEOUT_MS - 1);
    let settled = false;
    result.then(() => {
        settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(result).resolves.toBe("Song - Artist");
    resolve("https://example.test/late");
    await expect(result).resolves.toBe("Song - Artist");
    expect(jest.getTimerCount()).toBe(0);
});

it.each(["reject", "throw"])(
    "falls back and releases the timer when a plugin fails: %s",
    async mode => {
        jest.useFakeTimers();
        (pluginManager.getByMedia as jest.Mock).mockReturnValue({
            methods: {
                getMusicDetailPageUrl: () => {
                    if (mode === "throw")
                        throw new Error("private plugin error");
                    return Promise.reject(new Error("private plugin error"));
                },
            },
        });
        await expect(formatMusicShareMessage(song)).resolves.toBe(
            "Song - Artist",
        );
        expect(jest.getTimerCount()).toBe(0);
    },
);
it("shares a public detail page and never uses a resolved audio URL", async () => {
    (pluginManager.getByMedia as jest.Mock).mockReturnValue({
        methods: {
            getMusicDetailPageUrl: async () => "https://source.example/song/1",
        },
    });
    await expect(formatMusicShareMessage(song)).resolves.toBe(
        "Song - Artist\nhttps://source.example/song/1",
    );
});
it.each([
    "file:///private/file",
    // eslint-disable-next-line no-script-url -- unsafe input is rejected, never navigated.
    "javascript:code",
    "https://user:password@source.example/song",
    "https://source.example/a\nheader:value",
    "https://source.example/song extra",
    "https://source.example/\u0000",
    null,
])("falls back to the title for unsafe/missing detail pages", async url => {
    (pluginManager.getByMedia as jest.Mock).mockReturnValue({
        methods: { getMusicDetailPageUrl: async () => url },
    });
    await expect(formatMusicShareMessage(song)).resolves.toBe("Song - Artist");
});

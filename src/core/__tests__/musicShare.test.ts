jest.mock("../pluginManager", () => ({
    __esModule: true,
    default: { getByMedia: jest.fn() },
}));
import pluginManager from "../pluginManager";
import { formatMusicShareMessage } from "../musicShare";
const song = {
    id: "1",
    platform: "source",
    title: "Song",
    artist: "Artist",
    url: "https://secret/audio?token=private",
} as IMusic.IMusicItem;
it("shares a public detail page and never uses a resolved audio URL", async () => {
    (pluginManager.getByMedia as jest.Mock).mockReturnValue({
        methods: { getMusicDetailPageUrl: async () => "https://source.example/song/1" },
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

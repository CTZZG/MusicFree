jest.mock("@/utils/remoteMediaUrl", () => ({ validateRemoteMediaUrlForPlayback: jest.fn(async (url: string) => ({ ok: true, url })) }));
import { admitMusicVideoSource } from "../musicVideoAdmission";
import { validateRemoteMediaUrlForPlayback } from "@/utils/remoteMediaUrl";

test("video admission generates host transport flags and discards plugin native policy fields", async () => {
    const source: any = { url: "https://example.test/clip.mp4", headers: { Referer: "https://example.test" },
        trustedLocalMediaProxy: true, allowInsecureHttpPlayback: true, videoNetworkPolicy: "allow-metered", mediaId: "other", ekey: undefined };
    expect(await admitMusicVideoSource(source, false)).toEqual({ url: source.url, headers: source.headers, userAgent: undefined, allowInsecureHttpPlayback: false });
    expect(validateRemoteMediaUrlForPlayback).toHaveBeenCalledWith(source.url, { allowHttp: false });
});
test.each(["file:///private/clip.mp4", "content://media/1", "data:video/mp4,abc"])("an untrusted provider cannot supply a local video %s", async url => {
    await expect(admitMusicVideoSource({ url }, false)).rejects.toThrow();
});
test("video headers cannot inject additional native HTTP headers", async () => {
    await expect(admitMusicVideoSource({ url: "https://example.test/clip.mp4", headers: { Referer: "site\r\nInjected: value" } }, false)).rejects.toThrow();
});

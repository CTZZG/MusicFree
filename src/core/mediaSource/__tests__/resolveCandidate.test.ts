import { resolveMediaSourceCandidate } from "../resolveCandidate";
import { isTimeoutError, TimeoutError } from "@/utils/promiseTimeout";

const item = { id: "song", platform: "A" } as IMusic.IMusicItem;
const options = () => ({
    musicItem: item,
    pluginName: "A",
    qualityOrder: ["320k", "192k"],
    isActive: () => true,
    isTimeout: isTimeoutError,
    prepare: async (source: IPlugin.IMediaSourceResult) => source,
});

it("preserves playback's default stop-on-timeout rule", async () => {
    const request = jest.fn().mockRejectedValueOnce(new TimeoutError()).mockResolvedValue({ url: "https://example.com/192.mp3" });
    expect(await resolveMediaSourceCandidate({ ...options(), request })).toBeNull();
    expect(request.mock.calls).toEqual([["320k"]]);
});

it("stops on access-denied even when downloads continue after timeouts", async () => {
    const request = jest.fn().mockResolvedValueOnce({ failure: { code: "access-denied" } }).mockResolvedValue({ url: "https://example.com/192.mp3" });
    expect(await resolveMediaSourceCandidate({ ...options(), request, timeoutPolicy: "try-next-quality" })).toBeNull();
    expect(request.mock.calls).toEqual([["320k"]]);
});

it("keeps the default stop policy when source preparation throws a timeout", async () => {
    const request = jest.fn().mockResolvedValue({ url: "https://example.com/encrypted.mflac" });
    const prepare = jest.fn().mockRejectedValue(new TimeoutError());
    expect(await resolveMediaSourceCandidate({ ...options(), request, prepare })).toBeNull();
    expect(request.mock.calls).toEqual([["320k"]]);
});

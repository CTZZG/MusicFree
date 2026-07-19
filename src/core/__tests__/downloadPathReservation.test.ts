import DownloadPathReservation from "../downloadPathReservation";

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("DownloadPathReservation", () => {
    it("serializes the exists check and path reservation", async () => {
        const firstExists = deferred<boolean>();
        const exists = jest
            .fn<Promise<boolean>, [string]>()
            .mockImplementationOnce(() => firstExists.promise)
            .mockResolvedValue(false);
        const reservation = new DownloadPathReservation({
            resolvePath: fileName => `/downloads/${fileName}`,
            exists,
            createId: () => "fallback",
        });

        const first = reservation.reserve("song.mp3");
        const second = reservation.reserve("song.mp3");

        await Promise.resolve();
        expect(exists).toHaveBeenCalledTimes(1);

        firstExists.resolve(false);

        await expect(first).resolves.toBe("/downloads/song.mp3");
        await expect(second).resolves.toBe("/downloads/song (1).mp3");
    });

    it("releases paths and continues after a failed check", async () => {
        const exists = jest
            .fn<Promise<boolean>, [string]>()
            .mockRejectedValueOnce(new Error("filesystem unavailable"))
            .mockResolvedValue(false);
        const reservation = new DownloadPathReservation({
            resolvePath: fileName => `/downloads/${fileName}`,
            exists,
            createId: () => "fallback",
        });

        await expect(reservation.reserve("song.mp3")).rejects.toThrow(
            "filesystem unavailable",
        );
        await expect(reservation.reserve("song.mp3")).resolves.toBe(
            "/downloads/song.mp3",
        );

        reservation.release("/downloads/song.mp3");
        await expect(reservation.reserve("song.mp3")).resolves.toBe(
            "/downloads/song.mp3",
        );
    });

    it("retains a recovering transaction target", async () => {
        const reservation = new DownloadPathReservation({
            resolvePath: fileName => `/downloads/${fileName}`,
            exists: jest.fn().mockResolvedValue(false),
            createId: () => "fallback",
        });

        reservation.retain("/downloads/song.mp3");

        await expect(reservation.reserve("song.mp3")).resolves.toBe(
            "/downloads/song (1).mp3",
        );
    });
});

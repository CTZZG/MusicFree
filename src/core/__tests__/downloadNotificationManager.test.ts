jest.mock("@/utils/log", () => ({
    devLog: jest.fn(),
}));

jest.mock("@/native/mp3Util", () => ({
    __esModule: true,
    default: {
        publishDownloadCompleted: jest.fn(),
        cancelDownloadNotification: jest.fn(),
        clearDownloadNotifications: jest.fn(),
    },
}));

jest.mock("@/core/notificationPermissionManager", () => ({
    __esModule: true,
    default: {
        setup: jest.fn(),
        silentRequestPermission: jest.fn(async () => true),
        checkPermission: jest.fn(async () => true),
        requestPermission: jest.fn(async () => true),
        resetPermissionState: jest.fn(async () => undefined),
        openSettings: jest.fn(async () => undefined),
        getPermissionStatusDescription: jest.fn(async () => "granted"),
    },
}));

import Mp3Util from "@/native/mp3Util";
import { DownloadNotificationManager } from "../downloadNotificationManager";

const musicItem = {
    id: "song-1",
    platform: "test",
    title: "Song One",
    artist: "Artist One",
} as IMusic.IMusicItem;

describe("DownloadNotificationManager native deadlines", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it("does not let a non-resolving completion bridge block finalization", async () => {
        jest.mocked(Mp3Util.publishDownloadCompleted).mockImplementation(
            () => new Promise(() => {}),
        );
        const manager = new DownloadNotificationManager(40);
        const operation = manager.showCompleted(
            "attempt-1",
            musicItem,
            "/music/song.mp3",
        );
        let settled = false;
        void operation.then(() => {
            settled = true;
        });

        await jest.advanceTimersByTimeAsync(39);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(2);
        await expect(operation).resolves.toBeUndefined();
        expect(Mp3Util.publishDownloadCompleted).toHaveBeenCalledWith(
            "attempt-1",
            "Song One",
            "/music/song.mp3",
        );
    });

    it("bounds notification compensation when the cancel bridge hangs", async () => {
        jest.mocked(Mp3Util.cancelDownloadNotification!).mockImplementation(
            () => new Promise(() => {}),
        );
        const manager = new DownloadNotificationManager(40);
        const operation = manager.cancelNotification("attempt-1");

        await jest.advanceTimersByTimeAsync(41);
        await expect(operation).resolves.toBeUndefined();
        expect(Mp3Util.cancelDownloadNotification).toHaveBeenCalledWith(
            "attempt-1",
        );
    });
});

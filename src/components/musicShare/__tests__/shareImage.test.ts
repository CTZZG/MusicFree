jest.mock("react-native-fs", () => ({
    CachesDirectoryPath: "/cache",
    mkdir: jest.fn().mockResolvedValue(undefined),
    readDir: jest.fn(),
    unlink: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("react-native-share", () => ({
    __esModule: true,
    default: { open: jest.fn() },
}));
import * as fs from "react-native-fs";
import Share from "react-native-share";
import {
    captureShareCard,
    shareCardPng,
    ShareFilePreparationError,
} from "../shareImage";

describe("card image export", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        (Share.open as jest.Mock).mockResolvedValue({
            success: true,
            message: "receiver",
        });
        (fs.readDir as jest.Mock).mockResolvedValue([]);
    });
    afterEach(() => jest.useRealTimers());

    it("waits for a real callback and fails on a missing or empty image", async () => {
        let done!: (png: string) => void;
        const capture = captureShareCard(callback => {
            done = callback;
        });
        const rejected = capture.catch(error => error as Error);
        jest.advanceTimersByTime(5001);
        expect(await rejected).toEqual(
            expect.objectContaining({ message: "Image export timed out" }),
        );
        done("late image");
        await expect(
            captureShareCard(callback => callback("")),
        ).rejects.toThrow("Invalid image");
        await expect(
            captureShareCard(callback => callback("actual PNG")),
        ).resolves.toBe("actual PNG");
    });

    it("writes before sharing, retains recent attachments and prunes only its own stale files", async () => {
        const now = Date.now();
        (fs.readDir as jest.Mock).mockResolvedValue([
            {
                name: `card-${now}-1.png`,
                path: "/cache/musicfree-share/recent.png",
            },
            {
                name: `card-${now - 86400001}-1.png`,
                path: "/cache/musicfree-share/stale.png",
            },
            {
                name: "unrelated-file.png",
                path: "/cache/musicfree-share/unrelated-file.png",
            },
        ]);
        await shareCardPng("real-png-base64");
        expect(fs.unlink).toHaveBeenCalledTimes(1);
        expect(fs.unlink).toHaveBeenCalledWith(
            "/cache/musicfree-share/stale.png",
        );
        expect(fs.writeFile).toHaveBeenCalledWith(
            expect.stringMatching(
                /\/cache\/musicfree-share\/card-\d+-\d+\.png$/,
            ),
            "real-png-base64",
            "base64",
        );
        const file = (fs.writeFile as jest.Mock).mock.calls[0][0];
        expect(Share.open).toHaveBeenCalledWith({
            url: `file://${file}`,
            type: "image/png",
            failOnCancel: false,
        });
        expect(
            (fs.writeFile as jest.Mock).mock.invocationCallOrder[0],
        ).toBeLessThan((Share.open as jest.Mock).mock.invocationCallOrder[0]);
    });

    it("does not open a chooser if writing fails", async () => {
        (fs.readDir as jest.Mock).mockResolvedValue([]);
        (fs.writeFile as jest.Mock).mockRejectedValueOnce(new Error("full"));
        await expect(shareCardPng("png")).rejects.toBeInstanceOf(
            ShareFilePreparationError,
        );
        expect(Share.open).not.toHaveBeenCalled();
        expect(fs.unlink).toHaveBeenCalledWith(
            expect.stringMatching(/card-\d+-\d+\.png$/),
        );
    });

    it("removes only the current attachment on chooser dismissal", async () => {
        (Share.open as jest.Mock).mockResolvedValue({
            success: false,
            dismissedAction: true,
        });
        await expect(shareCardPng("png")).resolves.toEqual({
            success: false,
            dismissedAction: true,
        });
        const file = (fs.writeFile as jest.Mock).mock.calls[0][0];
        expect(fs.unlink).toHaveBeenCalledTimes(1);
        expect(fs.unlink).toHaveBeenCalledWith(file);
    });

    it("keeps a successful receiver's attachment and cleans a failed chooser's attachment", async () => {
        await shareCardPng("chosen-image");
        expect(fs.unlink).not.toHaveBeenCalled();
        (Share.open as jest.Mock).mockRejectedValueOnce(
            new Error("chooser failed"),
        );
        await expect(shareCardPng("second-image")).rejects.toThrow(
            "chooser failed",
        );
        expect(fs.unlink).toHaveBeenCalledTimes(1);
        expect(fs.unlink).toHaveBeenCalledWith(
            (fs.writeFile as jest.Mock).mock.calls[1][0],
        );
    });
});

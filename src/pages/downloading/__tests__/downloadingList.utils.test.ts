jest.mock("@/core/downloader", () => ({
    DownloadStatus: {
        Pending: 0,
        Preparing: 1,
        Downloading: 2,
        Paused: 3,
        Completed: 4,
        Error: 5,
    },
}));

jest.mock("@/utils/mediaExtra", () => ({
    getMediaExtraProperty: jest.fn(),
}));

jest.mock("@/utils/mediaUtils", () => ({
    getMediaUniqueKey: jest.fn(
        (musicItem: {platform?: string; id?: string}) =>
            `${musicItem.platform}@${musicItem.id}`,
    ),
}));

jest.mock("@/utils/fileUtils", () => ({
    getDirectory: jest.fn((filePath: string) =>
        filePath.split(/[\\/]/).slice(0, -1).join("/"),
    ),
    removeFileScheme: jest.fn((filePath: string) =>
        filePath?.replace(/^file:\/\//, ""),
    ),
}));

jest.mock("react-native-fs", () => ({
    exists: jest.fn(),
}));

import { DownloadStatus } from "@/core/downloader";
import { getMediaExtraProperty } from "@/utils/mediaExtra";
import {
    getDownloadWriteStatus,
    matchDownloadWriteFilter,
} from "../downloadingList.utils";

const mockGetMediaExtraProperty = getMediaExtraProperty as jest.Mock;

describe("download write status helpers", () => {
    const musicItem = {
        id: "track-1",
        platform: "test",
        title: "Track",
    } as IMusic.IMusicItem;

    beforeEach(() => {
        mockGetMediaExtraProperty.mockReset();
    });

    it("normalizes invalid media-extra write statuses to null", () => {
        mockGetMediaExtraProperty.mockReturnValue("done");

        expect(
            getDownloadWriteStatus(musicItem, "downloadMetadataStatus"),
        ).toBeNull();
    });

    it("does not match completed write filters with invalid stored statuses", () => {
        mockGetMediaExtraProperty.mockReturnValue("done");

        expect(
            matchDownloadWriteFilter(
                musicItem,
                DownloadStatus.Completed,
                "metadata-success",
            ),
        ).toBe(false);
        expect(
            matchDownloadWriteFilter(
                musicItem,
                DownloadStatus.Completed,
                "metadata-failed",
            ),
        ).toBe(false);
        expect(
            matchDownloadWriteFilter(
                musicItem,
                DownloadStatus.Completed,
                "metadata-skipped",
            ),
        ).toBe(false);
    });

    it("matches known completed write statuses", () => {
        mockGetMediaExtraProperty.mockImplementation((_item, key) =>
            key === "downloadMetadataStatus" ? "failed" : "success",
        );

        expect(
            matchDownloadWriteFilter(
                musicItem,
                DownloadStatus.Completed,
                "metadata-failed",
            ),
        ).toBe(true);
        expect(
            matchDownloadWriteFilter(
                musicItem,
                DownloadStatus.Completed,
                "lyric-success",
            ),
        ).toBe(true);
    });
});

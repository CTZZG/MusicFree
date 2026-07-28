jest.mock("react-native", () => ({
    NativeModules: {
        Qmc: {
            registerStream: jest.fn(),
            inspectStream: jest.fn(),
            decryptFile: jest.fn(),
        },
    },
}));

import Qmc from "../qmc";

const mockNativeQmc = (
    jest.requireMock("react-native") as {
        NativeModules: {
            Qmc: {
                registerStream: jest.Mock;
                inspectStream: jest.Mock;
                decryptFile: jest.Mock;
            };
        };
    }
).NativeModules.Qmc;

describe("QMC native wrapper", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("normalizes a supported native media type", async () => {
        mockNativeQmc.inspectStream.mockResolvedValue({
            audioSize: 123,
            extension: " FLAC ",
            contentType: " Audio/FLAC ",
        });

        await expect(
            Qmc.inspectStream("https://example.com/track.mflac"),
        ).resolves.toEqual({
            audioSize: 123,
            extension: "flac",
            contentType: "audio/flac",
        });
    });

    it.each([
        {
            audioSize: 123,
            extension: "bin",
            contentType: "audio/x-binary",
        },
        {
            audioSize: 123,
            extension: "flac",
            contentType: "audio/mpeg",
        },
        {
            audioSize: 1.5,
            extension: "flac",
            contentType: "audio/flac",
        },
    ])("rejects invalid native stream metadata: %o", async metadata => {
        mockNativeQmc.inspectStream.mockResolvedValue(metadata);

        await expect(
            Qmc.inspectStream("https://example.com/track.mflac"),
        ).rejects.toThrow("invalid stream metadata");
    });
});

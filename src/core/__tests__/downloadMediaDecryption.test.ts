import {
    assertQmcDecryptionOutput,
    createDownloadMediaPlan,
    selectDownloadSourceEncryption,
} from "../downloadMediaDecryption";

const supported = [".mp3", ".flac", ".ogg", ".m4a"];

describe("download media decryption plan", () => {
    it("keeps CENC cache encrypted and targets M4A", () => {
        expect(
            createDownloadMediaPlan({
                sourceExtension: "mmp4",
                cencKey: "00112233445566778899aabbccddeeff",
                supportedExtensions: supported,
            }),
        ).toEqual({
            extension: "m4a",
            cacheExtension: "cenc",
            decryption: {
                scheme: "cenc",
                key: "00112233445566778899aabbccddeeff",
            },
        });
    });

    it("uses native QMC sniffing for the target and persists its ekey", () => {
        expect(
            createDownloadMediaPlan({
                sourceExtension: "mflac",
                qmcInfo: {
                    audioSize: 123,
                    extension: "flac",
                    contentType: "audio/flac",
                },
                qmcEkey: "qmc-key",
                supportedExtensions: supported,
            }),
        ).toEqual({
            extension: "flac",
            cacheExtension: "qmc",
            decryption: {
                scheme: "qmc",
                ekey: "qmc-key",
                outputExtension: "flac",
            },
        });
    });

    it("supports an embedded-key QMC file without inventing an ekey", () => {
        expect(
            createDownloadMediaPlan({
                sourceExtension: "mgg",
                qmcInfo: {
                    audioSize: 456,
                    extension: "ogg",
                    contentType: "audio/ogg",
                },
                supportedExtensions: supported,
            }),
        ).toEqual({
            extension: "ogg",
            cacheExtension: "qmc",
            decryption: { scheme: "qmc", outputExtension: "ogg" },
        });
    });

    it.each(["bin", ""])(
        "rejects decrypted QMC extension %p outside the supported audio set",
        extension => {
            expect(() =>
                createDownloadMediaPlan({
                    sourceExtension: "mflac",
                    qmcInfo: {
                        audioSize: 123,
                        extension,
                        contentType: "audio/x-binary",
                    },
                    supportedExtensions: supported,
                }),
            ).toThrow("Unsupported decrypted QMC audio format");
        },
    );

    it("retains the legacy plain-source fallback only for non-encrypted files", () => {
        expect(
            createDownloadMediaPlan({
                sourceExtension: "unknown",
                supportedExtensions: supported,
            }),
        ).toEqual({
            extension: "mp3",
            cacheExtension: "mp3",
        });
    });

    it("clears encryption keys when a plugin selects a different URL", () => {
        expect(
            selectDownloadSourceEncryption({
                original: {
                    url: "https://old.example/song.mflac",
                    ekey: "old-ekey",
                    cek: "00112233445566778899aabbccddeeff",
                },
                resolved: { url: "https://new.example/song.flac" },
            }),
        ).toEqual({
            url: "https://new.example/song.flac",
            ekey: undefined,
            cek: undefined,
        });
    });

    it("keeps original keys only when the selected URL is unchanged", () => {
        expect(
            selectDownloadSourceEncryption({
                original: {
                    url: "https://example.com/song.mflac",
                    ekey: "old-ekey",
                },
                resolved: { url: "https://example.com/song.mflac" },
            }),
        ).toEqual({
            url: "https://example.com/song.mflac",
            ekey: "old-ekey",
            cek: undefined,
        });
        expect(
            selectDownloadSourceEncryption({
                original: {
                    url: "https://old.example/song.mflac",
                    ekey: "old-ekey",
                },
                resolved: {
                    url: "https://new.example/song.mflac",
                    ekey: "new-ekey",
                },
            }),
        ).toEqual({
            url: "https://new.example/song.mflac",
            ekey: "new-ekey",
            cek: undefined,
        });
    });

    it("rejects a QMC container that differs from the probed output", () => {
        expect(() =>
            assertQmcDecryptionOutput("flac", {
                audioSize: 123,
                extension: "ogg",
                contentType: "audio/ogg",
            }),
        ).toThrow("QMC decrypted format mismatch");
        expect(() =>
            assertQmcDecryptionOutput(".FLAC", {
                audioSize: 123,
                extension: "flac",
                contentType: "audio/flac",
            }),
        ).not.toThrow();
    });
});

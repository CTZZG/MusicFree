import {
    classifyMediaSourceFailure,
    createMediaSourceFailure,
    getMediaSourceFailureI18nKey,
    MediaSourceResolutionError,
    mediaSourceFailureFromPluginResult,
    mediaSourceFailureI18nKeys,
    preferMediaSourceFailure,
    preferUserFacingMediaSourceFailure,
} from "@/core/pluginManager/mediaSourceFailure";

describe("media source failure model", () => {
    const context = {
        mediaKey: "test@track-1",
        pluginName: "test",
        quality: "flac",
    };

    it("preserves structured failures and applies the latest context", () => {
        const error = new MediaSourceResolutionError(
            "encrypted-unsupported",
            "encrypted format is not supported",
            {
                pluginName: "old-plugin",
                quality: "320k",
            },
        );

        expect(classifyMediaSourceFailure(error, context)).toMatchObject({
            code: "encrypted-unsupported",
            retryable: false,
            ...context,
        });
    });

    it.each([
        [{ code: "ETIMEDOUT" }, "network-error", true],
        [new Error("NOT RETRY"), "unavailable", false],
        [{ message: "当前暂无此音质播放地址" }, "unavailable", false],
        [{ message: "播放地址协议不受支持" }, "invalid-url", false],
        [{ message: "仅允许使用公网 HTTPS 地址" }, "policy-blocked", false],
        [{ message: "QMC key or container validation failed" }, "encrypted-unsupported", false],
        [{ message: "解密密钥缺失" }, "encrypted-unsupported", false],
        [{ message: "unexpected parser failure" }, "plugin-error", true],
    ] as const)(
        "classifies %p as %s",
        (error, code, retryable) => {
            expect(classifyMediaSourceFailure(error, context)).toMatchObject({
                code,
                retryable,
                ...context,
            });
        },
    );

    it("uses structured plugin results and defaults missing results to unavailable", () => {
        expect(
            mediaSourceFailureFromPluginResult(
                { code: "network-error", retryable: false },
                context,
            ),
        ).toMatchObject({
            code: "network-error",
            retryable: false,
            ...context,
        });
        expect(
            mediaSourceFailureFromPluginResult(undefined, context),
        ).toMatchObject({
            code: "unavailable",
            retryable: false,
            ...context,
        });
    });

    it("keeps the most actionable failure across quality fallbacks", () => {
        const unavailable = createMediaSourceFailure("unavailable", context);
        const network = createMediaSourceFailure("network-error", context);
        const encrypted = createMediaSourceFailure(
            "encrypted-unsupported",
            context,
        );

        expect(preferMediaSourceFailure(unavailable, network)).toBe(network);
        expect(preferMediaSourceFailure(network, unavailable)).toBe(network);
        expect(preferMediaSourceFailure(network, encrypted)).toBe(encrypted);
    });

    it("does not mix a similar-track failure into the original-track result", () => {
        const original = createMediaSourceFailure("unavailable", {
            mediaKey: "original@track-1",
            pluginName: "original",
            quality: "flac",
        });
        const similar = createMediaSourceFailure(
            "encrypted-unsupported",
            {
                mediaKey: "candidate@track-2",
                pluginName: "candidate",
                quality: "320k",
            },
        );

        expect(
            preferUserFacingMediaSourceFailure(
                original,
                similar,
                "similar",
            ),
        ).toBe(original);
        expect(
            preferUserFacingMediaSourceFailure(
                null,
                similar,
                "similar",
            ),
        ).toBeNull();
    });

    it("provides a localized message key for every failure code", () => {
        const failures = [
            "unavailable",
            "network-error",
            "plugin-error",
            "invalid-url",
            "policy-blocked",
            "encrypted-unsupported",
            "source-rejected",
            "backend-error",
        ] as const;

        expect(Object.keys(mediaSourceFailureI18nKeys).sort()).toEqual(
            [...failures].sort(),
        );
        for (const code of failures) {
            expect(mediaSourceFailureI18nKeys[code]).toMatch(/^toast\./);
            expect(createMediaSourceFailure(code).retryable).toBe(
                ["network-error", "plugin-error", "backend-error"].includes(
                    code,
                ),
            );
        }
        expect(
            getMediaSourceFailureI18nKey("future-plugin-error-code"),
        ).toBe("toast.mediaSourcePluginError");
        expect(
            createMediaSourceFailure(
                "future-plugin-error-code" as IPlugin.IMediaSourceFailureCode,
            ),
        ).toMatchObject({
            code: "plugin-error",
            retryable: true,
        });
    });
});

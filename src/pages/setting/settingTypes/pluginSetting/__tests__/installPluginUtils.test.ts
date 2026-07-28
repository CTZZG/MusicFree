import type {
    IInstallPluginConfig,
    IInstallPluginResult,
    IPluginCapability,
} from "@/types/core/pluginManager";
import {
    createPluginInstaller,
    installPluginFromUrlText,
    installPluginsFromUrlTexts,
    runPluginInstallBatchWithCapabilityApproval,
    sanitizePluginInstallErrorMessage,
} from "../installPluginUtils";

const mockShowDialog = jest.fn();
const mockInstallPluginFromUrl = jest.fn();
const mockRemoteGet = jest.fn();
const mockGetConfig = jest.fn((_key?: string) => false);

jest.mock("@/components/dialogs/useDialog", () => ({
    showDialog: (...args: any[]) => mockShowDialog(...args),
}));

jest.mock("@/core/appConfig", () => ({
    __esModule: true,
    default: {
        getConfig: (key: string) => mockGetConfig(key),
    },
}));

jest.mock("@/core/pluginManager", () => ({
    __esModule: true,
    default: {
        installPluginFromUrl: (...args: any[]) =>
            mockInstallPluginFromUrl(...args),
    },
}));

jest.mock("@/core/pluginManager/diagnostics", () => ({
    recordPluginInstallFailure: jest.fn(),
}));

jest.mock("@/core/i18n", () => ({
    __esModule: true,
    default: {
        t: (key: string, args?: Record<string, any>) =>
            `${key}:${JSON.stringify(args ?? {})}`,
    },
}));

jest.mock("@/utils/restrictedHttpClient", () => ({
    createRestrictedHttpClient: () => ({
        get: (...args: any[]) => mockRemoteGet(...args),
    }),
}));

jest.mock("@/utils/toast", () => ({
    __esModule: true,
    default: {
        success: jest.fn(),
        warn: jest.fn(),
    },
}));

function capabilityRequiredResult(
    url: string,
    requiredCapabilities: IPluginCapability[],
): IInstallPluginResult {
    return {
        success: false,
        pluginUrl: url,
        sourceType: "network",
        failureReason: "capability-approval-required",
        retryable: true,
        requiredCapabilities,
    };
}

function successfulResult(url: string): IInstallPluginResult {
    return {
        success: true,
        pluginUrl: url,
        sourceType: "network",
    };
}

function installByRequiredCapabilities(
    requirements: Record<string, IPluginCapability[]>,
) {
    mockInstallPluginFromUrl.mockImplementation(
        async (url: string, config?: IInstallPluginConfig) => {
            const requiredCapabilities = requirements[url] ?? [];
            const approved = new Set(config?.approvedCapabilities ?? []);
            const missing = requiredCapabilities.filter(
                capability => !approved.has(capability),
            );
            return missing.length
                ? capabilityRequiredResult(url, missing)
                : successfulResult(url);
        },
    );
}

describe("plugin install error sanitization", () => {
    it.each([
        [
            "read failed at \"file:///Users/tester/My Plugin/plugin.js\"; retrying",
            "read failed at \"<local-path>\"; retrying",
        ],
        [
            "read failed at /storage/emulated/0/Download/plugin.js; retrying",
            "read failed at <local-path>; retrying",
        ],
        [
            "read failed at /data/user/0/app/cache/plugin.js; retrying",
            "read failed at <local-path>; retrying",
        ],
        [
            "read failed at /sdcard/Download/plugin.js; retrying",
            "read failed at <local-path>; retrying",
        ],
        [
            "read failed at /var/mobile/plugin.js; retrying",
            "read failed at <local-path>; retrying",
        ],
        [
            "read failed at /private/var/mobile/plugin.js; retrying",
            "read failed at <local-path>; retrying",
        ],
        [
            "read failed at /Users/tester/plugin.js; retrying",
            "read failed at <local-path>; retrying",
        ],
        [
            "read failed at \"/data/user/0/My Plugin/plugin.js\"; retrying",
            "read failed at \"<local-path>\"; retrying",
        ],
        [
            "read failed at (/private/var/My Plugin (Debug)/plugin.js); retrying",
            "read failed at (<local-path>); retrying",
        ],
        [
            "read failed at C:\\Users\\tester\\plugin.js; retrying",
            "read failed at <local-path>; retrying",
        ],
    ])("replaces local path in %s", (message, expected) => {
        expect(sanitizePluginInstallErrorMessage(message)).toBe(expected);
    });
});

describe("plugin capability approval batching", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetConfig.mockReturnValue(false);
    });

    it("aggregates a subscription collection into one confirmation", async () => {
        const urls = [
            "https://example.com/a.js",
            "https://example.com/b.js",
            "https://example.com/c.js",
        ];
        mockRemoteGet.mockResolvedValue({
            data: {
                plugins: urls.map(url => ({ url })),
            },
        });
        installByRequiredCapabilities({
            [urls[0]]: ["network.http"],
            [urls[1]]: ["network.http"],
            [urls[2]]: ["network.http", "storage.plugin"],
        });
        mockShowDialog.mockImplementation((_name, payload) => {
            payload.onOk();
        });

        const results = await installPluginFromUrlText(
            "https://example.com/plugins.json",
        );

        expect(results).toHaveLength(3);
        expect(results.every(result => result.success)).toBe(true);
        expect(mockShowDialog).toHaveBeenCalledTimes(1);
        expect(mockShowDialog.mock.calls[0][1].content).toContain(
            "\"pluginCount\":\"3\"",
        );
        expect(mockShowDialog.mock.calls[0][1].content).toContain(
            "network.http",
        );
        expect(mockShowDialog.mock.calls[0][1].content).toContain(
            "storage.plugin",
        );
        expect(mockInstallPluginFromUrl).toHaveBeenCalledTimes(6);
        for (const call of mockInstallPluginFromUrl.mock.calls.slice(0, 3)) {
            expect(call[1].approvedCapabilities).toEqual([]);
        }
    });

    it("uses one confirmation across multiple subscription sources", async () => {
        const firstUrl = "https://example.com/a.js";
        const secondUrl = "https://example.com/b.js";
        mockRemoteGet.mockImplementation(async (url: string) => ({
            data: {
                plugins: [
                    {
                        url: url.includes("first") ? firstUrl : secondUrl,
                    },
                ],
            },
        }));
        installByRequiredCapabilities({
            [firstUrl]: ["network.http"],
            [secondUrl]: ["network.http"],
        });
        mockShowDialog.mockImplementation((_name, payload) => {
            payload.onOk();
        });

        const results = await installPluginsFromUrlTexts([
            "https://example.com/first.json",
            "https://example.com/second.json",
        ]);

        expect(results.every(result => result.success)).toBe(true);
        expect(mockShowDialog).toHaveBeenCalledTimes(1);
        expect(mockShowDialog.mock.calls[0][1].content).toContain(
            "\"pluginCount\":\"2\"",
        );
    });

    it("does not retry capability-gated plugins when approval is cancelled", async () => {
        const urls = ["https://example.com/a.js", "https://example.com/b.js"];
        mockRemoteGet.mockResolvedValue({
            data: {
                plugins: urls.map(url => ({ url })),
            },
        });
        installByRequiredCapabilities({
            [urls[0]]: ["network.http"],
            [urls[1]]: ["storage.plugin"],
        });
        mockShowDialog.mockImplementation((_name, payload) => {
            payload.onCancel();
        });

        const results = await installPluginFromUrlText(
            "https://example.com/plugins.json",
        );

        expect(mockShowDialog).toHaveBeenCalledTimes(1);
        expect(mockInstallPluginFromUrl).toHaveBeenCalledTimes(2);
        expect(results).toHaveLength(2);
        expect(results.every(result => !result.success)).toBe(true);
        expect(
            results.every(
                result => result.message === "用户未确认本批插件新增能力",
            ),
        ).toBe(true);
    });

    it("does not silently approve a capability added after confirmation", async () => {
        const pluginUrl = "https://example.com/plugin.js";
        mockInstallPluginFromUrl
            .mockResolvedValueOnce(
                capabilityRequiredResult(pluginUrl, ["network.http"]),
            )
            .mockResolvedValueOnce(
                capabilityRequiredResult(pluginUrl, ["storage.plugin"]),
            );
        mockShowDialog.mockImplementation((_name, payload) => {
            payload.onOk();
        });

        const [result] = await installPluginFromUrlText(pluginUrl);

        expect(mockShowDialog).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            success: false,
            failureReason: "capability-approval-required",
            requiredCapabilities: ["storage.plugin"],
        });
    });

    it("retries only gated installers and preserves mixed result order", async () => {
        const installed = jest.fn(async () =>
            successfulResult("https://example.com/installed.js"),
        );
        const failed = jest.fn(async () => ({
            success: false,
            pluginUrl: "https://example.com/failed.js",
            sourceType: "network" as const,
            failureReason: "network" as const,
        }));
        const gated = jest.fn(
            async (approvedCapabilities: IPluginCapability[]) =>
                approvedCapabilities.includes("network.http")
                    ? successfulResult("https://example.com/gated.js")
                    : capabilityRequiredResult("https://example.com/gated.js", [
                        "network.http",
                    ]),
        );
        mockShowDialog.mockImplementation((_name, payload) => {
            payload.onOk();
        });

        const results = await runPluginInstallBatchWithCapabilityApproval([
            installed,
            failed,
            gated,
        ]);

        expect(results.map(result => result.pluginUrl)).toEqual([
            "https://example.com/installed.js",
            "https://example.com/failed.js",
            "https://example.com/gated.js",
        ]);
        expect(results.map(result => result.success)).toEqual([
            true,
            false,
            true,
        ]);
        expect(installed).toHaveBeenCalledTimes(1);
        expect(failed).toHaveBeenCalledTimes(1);
        expect(gated).toHaveBeenCalledTimes(2);
        expect(mockShowDialog).toHaveBeenCalledTimes(1);
    });

    it("continues the initial batch after one installer rejects", async () => {
        const rejected = createPluginInstaller(
            {
                pluginUrl: "https://example.com/rejected.js",
                sourceType: "network",
            },
            jest.fn(async () => {
                throw new Error(
                    "request failed?token=secret C:\\Users\\tester\\plugin.js",
                );
            }),
        );
        const installed = jest.fn(async () =>
            successfulResult("https://example.com/installed.js"),
        );

        const results = await runPluginInstallBatchWithCapabilityApproval([
            rejected,
            installed,
        ]);

        expect(results).toEqual([
            expect.objectContaining({
                success: false,
                message: "request failed?token=<redacted> <local-path>",
                pluginUrl: "https://example.com/rejected.js",
                sourceType: "network",
                failureReason: "unknown",
                retryable: true,
            }),
            expect.objectContaining({
                success: true,
                pluginUrl: "https://example.com/installed.js",
            }),
        ]);
        expect(installed).toHaveBeenCalledTimes(1);
    });

    it("converts an approved retry rejection without aborting later retries", async () => {
        const rejectedRetry = createPluginInstaller(
            {
                pluginUrl: "https://example.com/rejected.js",
                sourceType: "network",
            },
            jest
                .fn()
                .mockResolvedValueOnce(
                    capabilityRequiredResult(
                        "https://example.com/rejected.js",
                        ["network.http"],
                    ),
                )
                .mockRejectedValueOnce(new Error("retry rejected")),
        );
        const successfulRetry = jest.fn(
            async (approvedCapabilities: IPluginCapability[]) =>
                approvedCapabilities.length
                    ? successfulResult("https://example.com/installed.js")
                    : capabilityRequiredResult(
                        "https://example.com/installed.js",
                        ["network.http"],
                    ),
        );
        mockShowDialog.mockImplementation((_name, payload) => {
            payload.onOk();
        });

        const results = await runPluginInstallBatchWithCapabilityApproval([
            rejectedRetry,
            successfulRetry,
        ]);

        expect(results[0]).toMatchObject({
            success: false,
            message: "retry rejected",
            pluginUrl: "https://example.com/rejected.js",
            sourceType: "network",
            failureReason: "unknown",
            retryable: true,
        });
        expect(results[1]).toMatchObject({
            success: true,
            pluginUrl: "https://example.com/installed.js",
        });
        expect(successfulRetry).toHaveBeenCalledTimes(2);
    });

    it("preserves local file identity when an installer rejects", async () => {
        const rejected = createPluginInstaller(
            {
                pluginUrl: "local-plugin.js",
                sourceType: "local-file",
            },
            async () => {
                throw new Error("local parser failed");
            },
        );

        const [result] = await runPluginInstallBatchWithCapabilityApproval([
            rejected,
        ]);

        expect(result).toMatchObject({
            success: false,
            message: "local parser failed",
            pluginUrl: "local-plugin.js",
            sourceType: "local-file",
        });
    });

    it("preserves URL identity when the network installer rejects", async () => {
        const pluginUrl = "https://example.com/rejected.js";
        mockInstallPluginFromUrl.mockRejectedValue(
            new Error("Authorization: Bearer top-secret"),
        );

        const [result] = await installPluginFromUrlText(pluginUrl);

        expect(result).toMatchObject({
            success: false,
            message: "Authorization: Bearer <redacted>",
            pluginUrl,
            sourceType: "network",
        });
    });

    it("sanitizes subscription errors without losing the subscription URL", async () => {
        const subscriptionUrl = "https://example.com/plugins.json";
        mockRemoteGet.mockRejectedValue(
            new Error("fetch failed?access_token=secret Cookie=session-id"),
        );

        const [result] = await installPluginFromUrlText(subscriptionUrl);

        expect(result).toMatchObject({
            success: false,
            message: "fetch failed?access_token=<redacted> Cookie=<redacted>",
            pluginUrl: subscriptionUrl,
            sourceType: "network",
            failureReason: "network",
        });
    });

    it("keeps subscription resolution failures in their input position", async () => {
        const pluginUrl = "https://example.com/plugin.js";
        mockRemoteGet.mockRejectedValue({
            response: {
                status: 404,
            },
        });
        mockInstallPluginFromUrl.mockResolvedValue(successfulResult(pluginUrl));

        const results = await installPluginsFromUrlTexts([
            "https://example.com/missing.json",
            pluginUrl,
        ]);

        expect(results).toHaveLength(2);
        expect(results[0]).toMatchObject({
            success: false,
            pluginUrl: "https://example.com/missing.json",
            failureReason: "not-found",
        });
        expect(results[1]).toMatchObject({
            success: true,
            pluginUrl,
        });
        expect(mockShowDialog).not.toHaveBeenCalled();
    });
});

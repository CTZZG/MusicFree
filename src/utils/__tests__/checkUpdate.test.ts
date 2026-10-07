const mockGet = jest.fn();
const mockSupportedAbis = jest.fn(async () => ["arm64-v8a", "armeabi-v7a", "armeabi"]);
let mockVersion = "0.10.0";

jest.mock("react-native-device-info", () => ({
    __esModule: true,
    default: {
        getVersion: () => mockVersion,
        supportedAbis: () => mockSupportedAbis(),
    },
}));

jest.mock("../restrictedHttpClient", () => ({
    createRestrictedHttpClient: () => ({
        get: (...args: unknown[]) => mockGet(...args),
    }),
}));

import checkUpdate, { releaseNotesToLines } from "../checkUpdate";

const RELEASE_API = "https://api.github.com/repos/CTZZG/MusicFree/releases/latest";
const TAG_FALLBACK = "https://data.jsdelivr.com/v1/packages/gh/CTZZG/MusicFree/resolved?specifier=latest";
const ASSET_BASE = "https://github.com/CTZZG/MusicFree/releases/download/v0.11.0";

const releaseNotes = [
    "# MusicFree v0.11.0",
    "",
    "## 下载",
    "",
    "需要 Android 8.0 及以上。大部分手机下载 **arm64-v8a** 版。",
    "- `…-app-arm64-v8a-release.apk`：大部分手机",
    "",
    "## 升级前请注意",
    "",
    "- **歌词不再跟着系统字体放大**，请在歌词页选大一档。",
    "",
    "## 新功能",
    "",
    "- **播放失败时可以处理**：点开能看到[原因](https://example.com/x)。",
].join("\n");

function release(overrides: Record<string, unknown> = {}) {
    return {
        tag_name: "v0.11.0",
        draft: false,
        prerelease: false,
        html_url: "https://github.com/CTZZG/MusicFree/releases/tag/v0.11.0",
        body: releaseNotes,
        assets: [
            "android-build-info.txt",
            "MusicFree-0.11.0-abc1234-app-arm64-v8a-release.apk",
            "MusicFree-0.11.0-abc1234-app-armeabi-v7a-release.apk",
            "MusicFree-0.11.0-abc1234-app-universal-release.apk",
            "MusicFree-0.11.0-abc1234-app-x86_64-release.apk",
            "SHA256SUMS.txt",
        ].map(name => ({ name, browser_download_url: `${ASSET_BASE}/${name}` })),
        ...overrides,
    };
}

function respond(responses: Record<string, unknown>) {
    mockGet.mockImplementation(async (url: string) => {
        const data = responses[url];
        if (data instanceof Error) {
            throw data;
        }
        if (data === undefined) {
            throw new Error(`unexpected request ${url}`);
        }
        return { data };
    });
}

describe("checkUpdate", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockVersion = "0.10.0";
    });

    it("offers the APK for this phone's CPU first and the release page as the backup link", async () => {
        respond({ [RELEASE_API]: release() });

        await expect(checkUpdate()).resolves.toEqual({
            needUpdate: true,
            data: {
                version: "0.11.0",
                changeLog: [
                    "【升级前请注意】",
                    "· 歌词不再跟着系统字体放大，请在歌词页选大一档。",
                    "【新功能】",
                    "· 播放失败时可以处理：点开能看到原因。",
                ],
                download: [
                    `${ASSET_BASE}/MusicFree-0.11.0-abc1234-app-arm64-v8a-release.apk`,
                    "https://github.com/CTZZG/MusicFree/releases/tag/v0.11.0",
                ],
            },
        });
        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockGet).toHaveBeenCalledWith(RELEASE_API, expect.anything());
    });

    it("falls back to the universal APK when no build matches the CPU", async () => {
        mockSupportedAbis.mockResolvedValueOnce(["mips"]);
        respond({ [RELEASE_API]: release() });

        const result = await checkUpdate();
        expect(result?.data?.download[0]).toBe(
            `${ASSET_BASE}/MusicFree-0.11.0-abc1234-app-universal-release.apk`,
        );
    });

    it("reports the latest version as up to date instead of failing", async () => {
        mockVersion = "0.11.0";
        respond({ [RELEASE_API]: release() });

        await expect(checkUpdate()).resolves.toEqual({ needUpdate: false });
    });

    it("drops unsafe asset links and keeps the release page", async () => {
        respond({
            [RELEASE_API]: release({
                assets: [{
                    name: "MusicFree-0.11.0-abc1234-app-arm64-v8a-release.apk",
                    browser_download_url: "https://127.0.0.1/app.apk",
                }],
            }),
        });

        const result = await checkUpdate();
        expect(result?.data?.download).toEqual([
            "https://github.com/CTZZG/MusicFree/releases/tag/v0.11.0",
        ]);
    });

    it("uses jsDelivr's latest tag when GitHub's API cannot be reached", async () => {
        respond({
            [RELEASE_API]: new Error("timeout"),
            [TAG_FALLBACK]: { version: "0.11.0" },
        });

        await expect(checkUpdate()).resolves.toEqual({
            needUpdate: true,
            data: {
                version: "0.11.0",
                changeLog: [],
                download: ["https://github.com/CTZZG/MusicFree/releases/tag/v0.11.0"],
            },
        });
    });

    it("ignores drafts, pre-releases and tags that are not versions", async () => {
        for (const bad of [
            release({ draft: true }),
            release({ prerelease: true }),
            release({ tag_name: "vplugin" }),
        ]) {
            respond({ [RELEASE_API]: bad, [TAG_FALLBACK]: { version: "0.10.0" } });
            await expect(checkUpdate()).resolves.toEqual({ needUpdate: false });
        }
    });

    it("returns undefined when no source answers, so the caller can say the check failed", async () => {
        respond({
            [RELEASE_API]: new Error("offline"),
            [TAG_FALLBACK]: new Error("offline"),
        });

        await expect(checkUpdate()).resolves.toBeUndefined();
    });
});

describe("releaseNotesToLines", () => {
    it("keeps plain paragraphs and caps very long notes", () => {
        const body = ["## 改进与修复", "说明文字 `code`", ...Array.from({ length: 60 }, (_, i) => `- 第 ${i} 条`)].join("\n");
        const lines = releaseNotesToLines(body);
        expect(lines.slice(0, 3)).toEqual(["【改进与修复】", "说明文字 code", "· 第 0 条"]);
        expect(lines).toHaveLength(40);
    });

    it("returns nothing for a missing body", () => {
        expect(releaseNotesToLines(undefined)).toEqual([]);
    });
});

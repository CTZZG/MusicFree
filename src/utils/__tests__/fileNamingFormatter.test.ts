// fileNamingFormatter -> fileUtils -> pathConst 依赖 react-native-fs 原生模块
jest.mock("../fileUtils", () => ({
    escapeCharacter: (str?: string) =>
        str !== undefined ? `${str}`.replace(/[/|\\?*"<>:]+/g, "_") : "",
}));

import {
    formatFilename,
    generateFileNameFromConfig,
} from "../fileNamingFormatter";

const musicItem = {
    title: "烟火里的尘埃",
    artist: "华晨宇",
    album: "卡西莫多的礼物",
    platform: "QQ音乐",
    id: "1",
} as IMusic.IMusicItem;

describe("fileNamingFormatter", () => {
    describe("字节截断", () => {
        it("超长中文文件名按 UTF-8 字节截断到文件系统上限内", () => {
            const longTitle = "烟".repeat(200); // 200 字符 = 600 字节
            const result = formatFilename({
                template: "{title}",
                variables: {
                    title: longTitle,
                    artist: "",
                    album: "",
                    quality: "",
                    platform: "",
                    id: "",
                    alias: "",
                },
                maxLength: 200,
                keepExtension: true,
            });
            expect(result.truncated).toBe(true);
            expect(Buffer.byteLength(result.filename, "utf8")).toBeLessThanOrEqual(230);
        });

        it("短文件名不截断", () => {
            const result = formatFilename({
                template: "{title} - {artist}",
                variables: {
                    title: "歌名",
                    artist: "歌手",
                    album: "",
                    quality: "",
                    platform: "",
                    id: "",
                    alias: "",
                },
                maxLength: 200,
                keepExtension: true,
            });
            expect(result.truncated).toBe(false);
            expect(result.filename).toBe("歌名 - 歌手");
        });
    });

    describe("showQuality 开关", () => {
        it("开启时模板无 {quality} 会追加音质", () => {
            const result = generateFileNameFromConfig(
                musicItem,
                {
                    type: "preset",
                    preset: "歌曲名-歌手",
                    showQuality: true,
                    maxLength: 200,
                    keepExtension: true,
                },
                "320k",
            );
            expect(result.filename).toBe("烟火里的尘埃 - 华晨宇 - 320k");
        });

        it("模板已含 {quality} 时不重复追加", () => {
            const result = generateFileNameFromConfig(
                musicItem,
                {
                    type: "preset",
                    preset: "歌曲名-歌手-音质",
                    showQuality: true,
                    maxLength: 200,
                    keepExtension: true,
                },
                "320k",
            );
            expect(result.filename).toBe("烟火里的尘埃 - 华晨宇 - 320k");
        });

        it("关闭时不追加音质", () => {
            const result = generateFileNameFromConfig(
                musicItem,
                {
                    type: "preset",
                    preset: "歌曲名-歌手",
                    showQuality: false,
                    maxLength: 200,
                    keepExtension: true,
                },
                "320k",
            );
            expect(result.filename).toBe("烟火里的尘埃 - 华晨宇");
        });
    });
});

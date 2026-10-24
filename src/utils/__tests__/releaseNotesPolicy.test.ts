import fs from "fs";
import path from "path";
import { releaseNotesToLines } from "../releaseNotes";

// 当前版本的发布说明（docs/release-notes-v<版本>.md）和 changelog 条目只写给用户看：
// 发布说明就是 Release 正文，应用内“检查更新”也逐行显示。写法见 docs/release-notes-guide.md。
// 这里只拦得住明显的过程性内容和超长的说明，拦不住“写得不像人话”，发版前仍要按指南读一遍。
// 只检查 package.json 当前版本，以前发布的说明不受影响。

const rootDir = path.resolve(__dirname, "../../..");
const version: string = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
).version;

const ALLOWED_HEADINGS = ["升级前请注意", "新功能", "改进", "修复", "改进与修复", "已知问题", "下载"];
// 对话框里（“下载”一节不显示）最多的行数和每行字数
const MAX_DIALOG_LINES = 30;
const MAX_LINE_LENGTH = 100;
// changelog 不用的标签：验证过程、版本号和依赖升级不是用户看得到的变化
const INTERNAL_TAGS = ["验证", "发布", "依赖", "维护", "内核"];

// 只有自己用得上的内容：验证过程写进 PR 说明和 docs/handoff，依赖和审计写进 docs/architecture.md，
// 提交、构建号和签名已在附件 android-build-info.txt 里
const INTERNAL_TERMS: Array<[RegExp, string]> = [
    [/验证|验收|测试|模拟器|候选|全量/, "verification"],
    [/\b(?:Beta|CI|PR)\b/, "verification"],
    // 关于页有“构建信息”“构建版本”等字样，只拦构建号的值和构建流程
    [/构建号\s*\d|正式构建|构建日志|\bR8\b|\bDEX\b|签名|校验值/i, "build and release process"],
    [/依赖|审计|安全公告|GHSA-|\bnpm\b/i, "dependencies and audit"],
    [/libmpv|AudioTrack|MMKV|\bJNI\b|反射/i, "implementation details"],
    [/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/i, "commit hash"],
];

function lineProblems(line: string): string[] {
    const problems = INTERNAL_TERMS.flatMap(([pattern, kind]) => {
        const match = pattern.exec(line);
        return match ? [`${kind} ("${match[0]}"): ${line}`] : [];
    });
    if ([...line].length > MAX_LINE_LENGTH) {
        problems.push(`longer than ${MAX_LINE_LENGTH} characters: ${line}`);
    }
    return problems;
}

function releaseNotesProblems(body: string): string[] {
    const problems: string[] = [];
    for (const match of body.matchAll(/^#{2,6}\s+(.*)$/gm)) {
        const title = match[1].trim();
        if (!ALLOWED_HEADINGS.includes(title)) {
            problems.push(`section "${title}" is not one of ${ALLOWED_HEADINGS.join(", ")}`);
        }
    }
    const lines = releaseNotesToLines(body);
    if (lines.length > MAX_DIALOG_LINES) {
        problems.push(`the update dialog would show ${lines.length} lines (at most ${MAX_DIALOG_LINES})`);
    }
    return [...problems, ...lines.flatMap(lineProblems)];
}

function changelogProblems(changelog: string, expectedVersion: string): string[] {
    const header = /^`\d{4}\.\d{1,2}\.\d{1,2} v(\S+)`$/m.exec(changelog);
    if (!header) {
        return ["no version entry found"];
    }
    if (header[1] !== expectedVersion) {
        return [`the latest entry is v${header[1]}, expected v${expectedVersion}`];
    }
    const items = changelog
        .slice(header.index + header[0].length)
        .split(/\r?\n\s*\r?\n/)[0]
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    if (!items.length) {
        return [`the v${expectedVersion} entry has no items`];
    }
    return items.flatMap(item => {
        const tag = /^\d+\.\s*【([^】]+)】/.exec(item)?.[1];
        const problems = tag && INTERNAL_TAGS.includes(tag) ? [`tag 【${tag}】 is not a user-visible change: ${item}`] : [];
        return [...problems, ...lineProblems(item)];
    });
}

describe(`release notes and changelog for v${version}`, () => {
    it("keep the release notes to what users notice, in a short update dialog", () => {
        const notesPath = path.join(rootDir, "docs", `release-notes-v${version}.md`);
        expect(fs.existsSync(notesPath)).toBe(true);
        expect(releaseNotesProblems(fs.readFileSync(notesPath, "utf8"))).toEqual([]);
    });

    it("start the changelog with this version and list only user-visible changes", () => {
        const changelog = fs.readFileSync(path.join(rootDir, "changelog.md"), "utf8");
        expect(changelogProblems(changelog, version)).toEqual([]);
    });
});

describe("release notes policy", () => {
    it("flags verification, maintenance and dependency details", () => {
        const body = [
            "# MusicFree v9.9.9",
            "",
            "## 修复",
            "",
            "- 换音质后进度更准。",
            "",
            "## 维护",
            "",
            "- 播放内核 libmpv 按锁定的源码重新编译。",
            "- 升级 body-parser（2.4.0），处理新公布的高危安全公告。",
            "",
            "## 下载",
            "",
            "- `…-app-x86-release.apk`：模拟器用",
            "",
            "## 验证范围",
            "",
            "最终的 R8 Release 候选在 Android 14 模拟器完成 117 项全量检查，提交 038f588。",
        ].join("\n");
        const problems = releaseNotesProblems(body);
        expect(problems).toEqual(
            expect.arrayContaining([
                expect.stringContaining("section \"维护\""),
                expect.stringContaining("section \"验证范围\""),
                expect.stringContaining("implementation details"),
                expect.stringContaining("dependencies and audit"),
                expect.stringContaining("build and release process"),
                expect.stringContaining("verification"),
                expect.stringContaining("commit hash (\"038f588\")"),
            ]),
        );
        // “下载”一节不在对话框里显示，可以写给模拟器用的安装包
        expect(problems.join("\n")).not.toContain("模拟器用");
    });

    it("flags long dialogs and long lines", () => {
        const body = ["## 修复", ...Array.from({ length: 31 }, (_, i) => `- 第 ${i} 条`), `- ${"很".repeat(101)}`].join("\n");
        const problems = releaseNotesProblems(body);
        expect(problems).toEqual(
            expect.arrayContaining([
                expect.stringContaining("would show 33 lines"),
                expect.stringContaining("longer than 100 characters"),
            ]),
        );
    });

    it("flags internal changelog tags and an entry for another version", () => {
        const changelog = [
            "`2026.10.24 v9.9.9`",
            "1. 【播放】换音质后进度更准",
            "2. 【发布】版本升级至9.9.9",
            "",
            "`2026.10.23 v9.9.8`",
            "1. 【验证】旧条目不检查",
        ].join("\n");
        expect(changelogProblems(changelog, "9.9.9")).toEqual([
            "tag 【发布】 is not a user-visible change: 2. 【发布】版本升级至9.9.9",
        ]);
        expect(changelogProblems(changelog, "9.9.10")).toEqual(["the latest entry is v9.9.9, expected v9.9.10"]);
    });
});

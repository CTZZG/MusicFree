"use strict";
// 模拟器自动测试（e2e/run.sh）专用的第二个音源，用来检查播放失败时换到其他来源。
//
// 正常搜索（"e2e <提交号>"）时不返回任何歌，只记下提交号：测试主流程的搜索结果
// 因此和只装了测试源 A 时一样。应用为测试源 A 里取不到地址的歌找其他来源时，
// 会用“歌名 歌手”来搜，这时才返回下面的歌，地址指向记下的那个提交的测试音频。

const PLATFORM = "E2E 测试源 B";
const RAW_BASE = "https://raw.githubusercontent.com/CTZZG/MusicFree";

const SONGS = [
    // 和测试源 A 的 E2E Fallback 是同一个录音（时长差 1 秒，各平台常见的取整差）
    { id: "fallback", title: "E2E Fallback", album: "E2E Album", file: "tone-b.mp3", duration: 181 },
    // 测试源 A 的 E2E Live Only 在这里只有 Live 版，不能拿来顶替
    { id: "live-only-live", title: "E2E Live Only (Live)", album: "E2E Live", file: "tone-a.mp3", duration: 180 },
];

let lastRef = "";

function readRef(query) {
    const match = /(?:^|\s)([0-9a-f]{40})(?:\s|$)/i.exec(String(query || ""));
    return match ? match[1].toLowerCase() : "";
}

module.exports = {
    platform: PLATFORM,
    version: "1.0.0",
    author: "MusicFree E2E",
    description: "模拟器自动测试专用",
    supportedSearchType: ["music"],

    async search(query, page, type) {
        const ref = readRef(query);
        if (ref) {
            lastRef = ref;
            return { isEnd: true, data: [] };
        }
        const keyword = String(query || "").toLowerCase();
        if (type !== "music" || page > 1 || !lastRef || !keyword.startsWith("e2e ")) {
            return { isEnd: true, data: [] };
        }
        return {
            isEnd: true,
            data: SONGS
                .filter(song => song.title.toLowerCase().startsWith(keyword.split(" e2e artist")[0]))
                .map(song => ({
                    id: song.id,
                    title: song.title,
                    artist: "E2E Artist",
                    album: song.album,
                    duration: song.duration,
                    e2eRef: lastRef,
                    e2eFile: song.file,
                })),
        };
    },

    async getMediaSource(musicItem) {
        const ref = String(musicItem.e2eRef || "");
        if (!musicItem.e2eFile || !/^[0-9a-f]{40}$/.test(ref)) {
            return { failure: { code: "unavailable", retryable: false } };
        }
        return {
            url: `${RAW_BASE}/${ref}/e2e/fixtures/${musicItem.e2eFile}`,
        };
    },
};

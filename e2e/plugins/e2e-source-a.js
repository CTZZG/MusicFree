"use strict";
// 模拟器自动测试（e2e/run.sh）专用的音源，不要装在日常用的手机上。
//
// 搜索关键字要写成 "e2e <40 位提交号>"：歌曲文件从这个提交的 e2e/fixtures/
// 读取，测试音频和测试脚本因此总是同一个版本。不带提交号的搜索没有结果，
// 误装了也不会混进正常的搜索结果里。

const PLATFORM = "E2E 测试源 A";
const RAW_BASE = "https://raw.githubusercontent.com/CTZZG/MusicFree";

const SONGS = [
    // A 要从播放统计一直放到冷启动续播，比另外两首长（见 fixtures/generate.sh）
    { id: "tone-a", title: "E2E Tone A", file: "tone-a.mp3", duration: 480 },
    { id: "tone-b", title: "E2E Tone B", file: "tone-b.mp3", duration: 180 },
    { id: "tone-c", title: "E2E Tone C", file: "tone-c.mp3", duration: 180 },
    // 取不到播放地址，用来检查播放失败后的提示
    { id: "broken", title: "E2E Broken", file: "", duration: 180 },
    // 这两首在这里都取不到地址。测试源 B 有同一首 Fallback（应当自动换过去），
    // Live Only 在 B 只有 Live 版（不是同一个录音，不能换）
    { id: "fallback", title: "E2E Fallback", file: "", duration: 180 },
    { id: "live-only", title: "E2E Live Only", file: "", duration: 180 },
    // 20 秒就播完，用来检查在后台播完后自动接下一首。新装的应用点搜索结果会用整页
    // 结果替换播放队列，所以它要排在最后：播完绕回第一首 A
    { id: "short", title: "E2E Short", file: "short.mp3", duration: 20 },
];

// 只在搜 "e2e hang <提交号>" 时出现：B、C 和一首取播放地址时一直不回应的 Hang。
// 用来检查插件不回应时，切歌只等一轮取源期限就回到原来那首（见 run.sh）。不放进
// 上面的列表：多一行会把 Short 挤到迷你播放器下面，点不到
const HANG_SONGS = [
    SONGS[1],
    SONGS[2],
    { id: "hang", title: "E2E Hang", file: "", duration: 180 },
];

// 只有这几档音质，选无损之类的取不到：用来检查切换音质失败时，保持原来的音质接着播。
// 应用先用新写法（192k）问，取不到再用旧写法（standard）问一遍
const QUALITIES = ["128k", "192k", "320k", "low", "standard", "high"];

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
        if (type !== "music" || page > 1 || !ref) {
            return { isEnd: true, data: [] };
        }
        const songs = /(?:^|\s)hang(?:\s|$)/i.test(String(query)) ? HANG_SONGS : SONGS;
        return {
            isEnd: true,
            data: songs.map(song => ({
                id: song.id,
                title: song.title,
                artist: "E2E Artist",
                album: "E2E Album",
                duration: song.duration,
                e2eRef: ref,
                e2eFile: song.file,
            })),
        };
    },

    getMediaSource(musicItem, quality) {
        if (musicItem.id === "hang") {
            // 一直不回应：不 resolve 也不 reject
            return new Promise(() => undefined);
        }
        return Promise.resolve(resolveMediaSource(musicItem, quality));
    },
};

function resolveMediaSource(musicItem, quality) {
    const ref = String(musicItem.e2eRef || "");
    if (!musicItem.e2eFile || !/^[0-9a-f]{40}$/.test(ref)) {
        return { failure: { code: "unavailable", retryable: false } };
    }
    if (quality && !QUALITIES.includes(quality)) {
        return { failure: { code: "unavailable", retryable: false } };
    }
    return {
        url: `${RAW_BASE}/${ref}/e2e/fixtures/${musicItem.e2eFile}`,
    };
}

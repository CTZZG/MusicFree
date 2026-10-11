"use strict";
// API36 real-JS fixture. Only a pinned 40-character source SHA returns songs.
// Keep separate from the ordinary E2E source: its queue and timings are unchanged.
const BASE = "https://raw.githubusercontent.com/CTZZG/MusicFree";
let requestId = 0;
const songs = [
    { id: "b", title: "JS Flow B", file: "tone-b.mp3" },
    { id: "c", title: "JS Flow C", file: "tone-c.mp3" },
    { id: "hang", title: "JS Flow Hang", file: "" },
];
const qualityKeys = { low: "128k", standard: "192k", high: "320k" };

function event(eventName, item, quality, id) {
    console.log("E2E_JS_FLOW " + JSON.stringify({
        event: eventName, id: item.id, quality, requestId: id, wallMs: Date.now(),
    }));
}

module.exports = {
    platform: "E2E JS Flow",
    version: "1.0.0",
    author: "MusicFree E2E",
    cacheControl: "no-store",
    supportedSearchType: ["music"],
    supportedQualities: ["128k", "192k", "320k"],
    async search(query, page, type) {
        const match = /^js-flow ([0-9a-f]{40}) (seed|queue)$/i.exec(String(query));
        if (!match || page > 1 || type !== "music") return { isEnd: true, data: [] };
        const selected = match[2].toLowerCase() === "seed" ? songs.slice(0, 1) : songs;
        return { isEnd: true, data: selected.map(song => ({
            id: song.id, title: song.title, artist: "E2E Artist", album: "JS Flow",
            duration: 180, e2eRef: match[1].toLowerCase(), e2eFile: song.file,
        })) };
    },
    async getMediaSource(item, requestedQuality) {
        const quality = qualityKeys[requestedQuality] || requestedQuality || "192k";
        if (!/^[0-9a-f]{40}$/.test(String(item.e2eRef)) || !["128k", "192k", "320k"].includes(quality)) {
            return { failure: { code: "unavailable", retryable: false } };
        }
        const id = ++requestId;
        event("begin", item, quality, id);
        if (item.id === "hang") return new Promise(() => undefined);
        if (item.id === "c") await new Promise(resolve => setTimeout(resolve, 9000));
        event("resolved", item, quality, id);
        // The query distinguishes a real HQ/MQ source replacement of the same recording.
        return { url: `${BASE}/${item.e2eRef}/e2e/fixtures/${item.e2eFile}?jsFlowQuality=${quality}` };
    },
};

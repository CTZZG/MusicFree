import { musicHistorySheetId } from "@/constants/commonConst";
import { getMediaUniqueKey, isSameMediaItem } from "@/utils/mediaUtils";
import { getStorage } from "@/utils/storage";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import { useMemo } from "react";

import type { IAppConfig } from "@/types/core/config";
import type {
    IMusicHistory,
    IMusicPlayStat,
} from "@/types/core/musicHistory.js";
import type { IInjectable } from "@/types/infra";
import appMeta from "@/utils/appMeta";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { safeParse, safeStringify } from "@/utils/jsonUtil";


const musicHistoryAtom = atom<IMusic.IMusicItem[]>([]);
const musicPlayStatsAtom = atom<Record<string, IMusicPlayStat>>({});
const musicHistoryStore = getOrCreateMMKV("music.MusicHistory");
const musicPlayStatsLimit = 500;

class MusicHistory implements IMusicHistory, IInjectable {
    private configService!: IAppConfig;

    injectDependencies(configService: IAppConfig): void {
        this.configService = configService;
    }

    get history() {
        return getDefaultStore().get(musicHistoryAtom);
    }

    get playStats() {
        return getDefaultStore().get(musicPlayStatsAtom);
    }

    async setup() {
        if (appMeta.historySheetVersion < 1) {
            await this.migrateToMMKV();
        }

        const history = safeParse(musicHistoryStore.getString("history") ?? "[]") as IMusic.IMusicItem[];
        const playStats = safeParse(
            musicHistoryStore.getString("play-stats") ?? "{}",
        ) as Record<string, IMusicPlayStat>;
        getDefaultStore().set(musicHistoryAtom, history ?? []);
        getDefaultStore().set(musicPlayStatsAtom, playStats ?? {});
    }

    async addMusic(musicItem: IMusic.IMusicItem) {
        this.incrementPlayStat(musicItem);

        const newMusicHistory = [
            musicItem,
            ...this.history
                .filter(item => !isSameMediaItem(item, musicItem)),
        ].slice(0, this.configService.getConfig("basic.maxHistoryLen") ?? 50);
        
        musicHistoryStore.set("history", safeStringify(newMusicHistory));
        getDefaultStore().set(musicHistoryAtom, newMusicHistory);
    }

    async removeMusic(musicItem: IMusic.IMusicItem) {
        const newMusicHistory = this.history
            .filter(item => !isSameMediaItem(item, musicItem));
        const nextPlayStats = {
            ...this.playStats,
        };
        delete nextPlayStats[getMediaUniqueKey(musicItem)];
        
        musicHistoryStore.set("history", safeStringify(newMusicHistory));
        this.setPlayStats(nextPlayStats);
        getDefaultStore().set(musicHistoryAtom, newMusicHistory);
    }

    async clearMusic() {
        musicHistoryStore.set("history", safeStringify([]));
        this.setPlayStats({});
        getDefaultStore().set(musicHistoryAtom, []);
    }

    async setHistory(newHistory: IMusic.IMusicItem[]) {
        const currentPlayStats = this.playStats;
        const now = Date.now();
        const nextPlayStats: Record<string, IMusicPlayStat> = {};
        newHistory.forEach((musicItem, index) => {
            const key = getMediaUniqueKey(musicItem);
            nextPlayStats[key] = currentPlayStats[key] ?? {
                musicItem,
                count: 1,
                lastPlayedAt: now - index,
            };
        });

        musicHistoryStore.set("history", safeStringify(newHistory));
        this.setPlayStats(nextPlayStats);
        getDefaultStore().set(musicHistoryAtom, newHistory);
    }

    async migrateToMMKV() {
        const history = await getStorage(musicHistorySheetId);
        if (history?.length) {
            musicHistoryStore.set("history", safeStringify(history));
        }
        appMeta.setHistorySheetVersion(1);
    }

    private incrementPlayStat(musicItem: IMusic.IMusicItem) {
        const key = getMediaUniqueKey(musicItem);
        const current = this.playStats[key];
        this.setPlayStats({
            ...this.playStats,
            [key]: {
                musicItem,
                count: (current?.count ?? 0) + 1,
                lastPlayedAt: Date.now(),
            },
        });
    }

    private setPlayStats(playStats: Record<string, IMusicPlayStat>) {
        const nextPlayStats = this.trimPlayStats(playStats);
        musicHistoryStore.set("play-stats", safeStringify(nextPlayStats));
        getDefaultStore().set(musicPlayStatsAtom, nextPlayStats);
    }

    private trimPlayStats(playStats: Record<string, IMusicPlayStat>) {
        return Object.fromEntries(
            Object.entries(playStats)
                .filter(([, stat]) => stat?.musicItem && stat.count > 0)
                .sort(
                    ([, a], [, b]) =>
                        b.count - a.count ||
                        b.lastPlayedAt - a.lastPlayedAt,
                )
                .slice(0, musicPlayStatsLimit),
        );
    }
}


export function useMusicHistory() {
    return useAtomValue(musicHistoryAtom);
}

export function useMostPlayedMusic() {
    const playStats = useAtomValue(musicPlayStatsAtom);

    return useMemo(
        () =>
            Object.values(playStats)
                .filter(stat => stat?.musicItem && stat.count > 0)
                .sort(
                    (a, b) =>
                        b.count - a.count ||
                        b.lastPlayedAt - a.lastPlayedAt,
                )
                .map(stat => stat.musicItem),
        [playStats],
    );
}

const musicHistory = new MusicHistory();
export default musicHistory;

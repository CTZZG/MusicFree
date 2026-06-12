import EventEmitter from "eventemitter3";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { getMediaUniqueKey } from "@/utils/mediaUtils";

export type IDislikeRuleType = "music" | "artist-title" | "artist";

export interface IDislikeRule {
    id: string;
    type: IDislikeRuleType;
    createdAt: number;
    platform?: string;
    musicId?: string;
    title?: string;
    artist?: string;
}

const store = getOrCreateMMKV("dislike-music");
const rulesKey = "rules";
const rulesAtom = atom<IDislikeRule[]>([]);
const ee = new EventEmitter<{
    updated: () => void;
}>();

function normalizeText(value?: string | number | null) {
    return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function safeReadRules() {
    try {
        const raw = store.getString(rulesKey);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(rule => rule?.id) : [];
    } catch {
        return [];
    }
}

function setRules(rules: IDislikeRule[]) {
    store.set(rulesKey, JSON.stringify(rules));
    getDefaultStore().set(rulesAtom, rules);
    ee.emit("updated");
}

function getRules() {
    return getDefaultStore().get(rulesAtom);
}

function createRuleId(rule: Omit<IDislikeRule, "id" | "createdAt">) {
    if (rule.type === "music") {
        return `music:${rule.platform ?? ""}:${rule.musicId ?? ""}`;
    }
    if (rule.type === "artist-title") {
        return `artist-title:${normalizeText(rule.artist)}:${normalizeText(rule.title)}`;
    }
    return `artist:${normalizeText(rule.artist)}`;
}

function buildRule(
    musicItem: IMusic.IMusicItem,
    type: IDislikeRuleType,
): IDislikeRule | null {
    const baseRule = {
        type,
        platform: musicItem.platform,
        musicId: musicItem.id == null ? undefined : `${musicItem.id}`,
        title: musicItem.title,
        artist: musicItem.artist,
    };
    if (type === "music" && (!baseRule.platform || !baseRule.musicId)) {
        return null;
    }
    if (type === "artist-title" && (!normalizeText(baseRule.artist) || !normalizeText(baseRule.title))) {
        return null;
    }
    if (type === "artist" && !normalizeText(baseRule.artist)) {
        return null;
    }
    return {
        ...baseRule,
        id: createRuleId(baseRule),
        createdAt: Date.now(),
    };
}

function addRuleForMusic(
    musicItem: IMusic.IMusicItem,
    type: IDislikeRuleType,
) {
    const rule = buildRule(musicItem, type);
    if (!rule) {
        return null;
    }
    const rules = getRules();
    const nextRules = [
        rule,
        ...rules.filter(item => item.id !== rule.id),
    ];
    setRules(nextRules);
    return rule;
}

function removeRule(ruleId: string) {
    setRules(getRules().filter(rule => rule.id !== ruleId));
}

function clearRules() {
    setRules([]);
}

function matchRule(rule: IDislikeRule, musicItem: IMusic.IMusicItem) {
    if (rule.type === "music") {
        return rule.id === createRuleId({
            type: "music",
            platform: musicItem.platform,
            musicId: musicItem.id == null ? undefined : `${musicItem.id}`,
        });
    }
    if (rule.type === "artist-title") {
        return (
            normalizeText(rule.artist) === normalizeText(musicItem.artist) &&
            normalizeText(rule.title) === normalizeText(musicItem.title)
        );
    }
    return normalizeText(rule.artist) === normalizeText(musicItem.artist);
}

function getMatchedRules(musicItem?: IMusic.IMusicItem | null) {
    if (!musicItem) {
        return [];
    }
    return getRules().filter(rule => matchRule(rule, musicItem));
}

function removeMatchedRules(musicItem: IMusic.IMusicItem) {
    const matchedRuleIds = new Set(getMatchedRules(musicItem).map(rule => rule.id));
    if (!matchedRuleIds.size) {
        return 0;
    }
    setRules(getRules().filter(rule => !matchedRuleIds.has(rule.id)));
    return matchedRuleIds.size;
}

function isDisliked(musicItem?: IMusic.IMusicItem | null) {
    return getMatchedRules(musicItem).length > 0;
}

function getMusicKey(musicItem: IMusic.IMusicItem) {
    try {
        return getMediaUniqueKey(musicItem);
    } catch {
        return `${musicItem.platform ?? ""}@${musicItem.id ?? ""}`;
    }
}

function setup() {
    getDefaultStore().set(rulesAtom, safeReadRules());
}

export function useDislikeRules() {
    return useAtomValue(rulesAtom);
}

export function useDislikeRulesVersion() {
    const rules = useAtomValue(rulesAtom);
    return rules.map(rule => rule.id).join("|");
}

const DislikeMusic = {
    setup,
    getRules,
    addRuleForMusic,
    removeRule,
    clearRules,
    getMatchedRules,
    removeMatchedRules,
    isDisliked,
    getMusicKey,
    onUpdated(callback: () => void) {
        ee.on("updated", callback);
        return () => ee.off("updated", callback);
    },
};

DislikeMusic.setup();

export default DislikeMusic;

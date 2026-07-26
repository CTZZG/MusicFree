import { atom, getDefaultStore, useAtomValue } from "jotai";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { devLog } from "@/utils/log";
import {
    EQUALIZER_BANDS,
    EQUALIZER_GAIN,
    EQUALIZER_PRESETS,
    FLAT_GAINS,
    CUSTOM_PRESET_ID,
    type IEqualizerController,
} from "./bands";

/**
 * 均衡器状态层。
 *
 * 负责状态管理与持久化，通过 IEqualizerController 把状态推给底层音频引擎。
 * 默认是 no-op，由 `bootstrap.ts` 在播放器初始化后注入
 * `nitroEqualizerController`（真实 DSP）——注入必须晚于播放器初始化，
 * 因为 Nitro 在那时才把效果器绑到音频会话。
 *
 * MPV 后端下不注入：效果器挂在播放器音频会话上，MPV 不经过该会话。
 * 此时 UI 入口也会隐藏，避免重现「能拖但没声音变化」的假功能。
 */

export {
    CUSTOM_PRESET_ID,
    EQUALIZER_BANDS,
    EQUALIZER_GAIN,
    EQUALIZER_PRESETS,
    FLAT_GAINS,
    isEqualizerSupported,
    type IEqualizerController,
    type IEqualizerPreset,
} from "./bands";

const noopController: IEqualizerController = {
    setEnabled(enabled) {
        devLog("info", "[Equalizer] setEnabled (no-op)", { enabled });
    },
    setGains(gains) {
        devLog("info", "[Equalizer] setGains (no-op)", { gains });
    },
};

let controller: IEqualizerController = noopController;

const store = getOrCreateMMKV("equalizer");
const ENABLED_KEY = "enabled";
const PRESET_KEY = "preset";
const GAINS_KEY = "gains";

const enabledAtom = atom(false);
const presetAtom = atom<string>("flat");
const gainsAtom = atom<number[]>(FLAT_GAINS);

function clampGain(value: number) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(EQUALIZER_GAIN.max, Math.max(EQUALIZER_GAIN.min, value));
}

function normalizeGains(input: unknown): number[] {
    if (!Array.isArray(input) || input.length !== EQUALIZER_BANDS.length) {
        return [...FLAT_GAINS];
    }
    return input.map(value => clampGain(Number(value)));
}

function readGains(): number[] {
    try {
        const raw = store.getString(GAINS_KEY);
        return normalizeGains(raw ? JSON.parse(raw) : null);
    } catch {
        return [...FLAT_GAINS];
    }
}

function pushToController() {
    const s = getDefaultStore();
    const enabled = s.get(enabledAtom);
    controller.setEnabled(enabled);
    controller.setGains(enabled ? s.get(gainsAtom) : FLAT_GAINS);
}

function setup() {
    const s = getDefaultStore();
    s.set(enabledAtom, store.getBoolean(ENABLED_KEY) ?? false);
    s.set(presetAtom, store.getString(PRESET_KEY) ?? "flat");
    s.set(gainsAtom, readGains());
    pushToController();
}

function setEnabled(enabled: boolean) {
    store.set(ENABLED_KEY, enabled);
    getDefaultStore().set(enabledAtom, enabled);
    pushToController();
}

function selectPreset(presetId: string) {
    const preset = EQUALIZER_PRESETS.find(item => item.id === presetId);
    if (!preset) {
        return;
    }
    const gains = normalizeGains(preset.gains);
    store.set(PRESET_KEY, presetId);
    store.set(GAINS_KEY, JSON.stringify(gains));
    const s = getDefaultStore();
    s.set(presetAtom, presetId);
    s.set(gainsAtom, gains);
    pushToController();
}

function setBandGain(index: number, gain: number) {
    const s = getDefaultStore();
    const current = s.get(gainsAtom);
    if (index < 0 || index >= current.length) {
        return;
    }
    const next = current.slice();
    next[index] = clampGain(gain);
    store.set(GAINS_KEY, JSON.stringify(next));
    store.set(PRESET_KEY, CUSTOM_PRESET_ID);
    s.set(gainsAtom, next);
    s.set(presetAtom, CUSTOM_PRESET_ID);
    pushToController();
}

function reset() {
    selectPreset("flat");
}

/** 注入真实的底层均衡器实现（Nitro DSP 接入后调用） */
function setController(next: IEqualizerController) {
    controller = next ?? noopController;
    pushToController();
}

export function useEqualizerEnabled() {
    return useAtomValue(enabledAtom);
}

export function useEqualizerPreset() {
    return useAtomValue(presetAtom);
}

export function useEqualizerGains() {
    return useAtomValue(gainsAtom);
}

const Equalizer = {
    setup,
    setEnabled,
    selectPreset,
    setBandGain,
    reset,
    setController,
};

Equalizer.setup();

export default Equalizer;

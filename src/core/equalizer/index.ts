import { atom, getDefaultStore, useAtomValue } from "jotai";
import getOrCreateMMKV from "@/utils/getOrCreateMMKV";
import { devLog } from "@/utils/log";

/**
 * 均衡器（UI 外壳）
 *
 * 本模块负责均衡器的状态管理与持久化，并通过 IEqualizerController 适配器把
 * 状态推给底层音频引擎。当前默认注入的是一个 no-op stub —— Nitro Player 的
 * DSP 接入完成后，调用 Equalizer.setController(realController) 即可让 UI 立即
 * 生效，无需改动界面层。
 */

/** 频段中心频率（Hz），与 UI 行一一对应 */
export const EQUALIZER_BANDS: { freq: number; label: string }[] = [
    { freq: 60, label: "60" },
    { freq: 230, label: "230" },
    { freq: 910, label: "910" },
    { freq: 3600, label: "3.6k" },
    { freq: 14000, label: "14k" },
];

/** 增益范围（dB） */
export const EQUALIZER_GAIN = {
    min: -12,
    max: 12,
    step: 1,
};

export interface IEqualizerPreset {
    id: string;
    label: string;
    gains: number[];
}

const FLAT_GAINS = EQUALIZER_BANDS.map(() => 0);

/** 预设（增益数组长度需与 EQUALIZER_BANDS 一致） */
export const EQUALIZER_PRESETS: IEqualizerPreset[] = [
    { id: "flat", label: "默认", gains: [0, 0, 0, 0, 0] },
    { id: "pop", label: "流行", gains: [-1, 2, 4, 2, -1] },
    { id: "rock", label: "摇滚", gains: [4, 2, 0, 2, 4] },
    { id: "classic", label: "古典", gains: [4, 3, 0, 2, 4] },
    { id: "bass", label: "重低音", gains: [6, 4, 1, 0, 0] },
    { id: "vocal", label: "人声", gains: [-2, 1, 4, 3, 0] },
    { id: "treble", label: "高音", gains: [0, 0, 1, 4, 6] },
];

export const CUSTOM_PRESET_ID = "custom";

/** 底层音频引擎适配器：UI 只依赖这个接口，不关心具体实现 */
export interface IEqualizerController {
    setEnabled(enabled: boolean): void;
    setGains(gains: number[]): void;
}

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

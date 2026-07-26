/**
 * 均衡器的纯数据定义（频段、量程、预设）。
 *
 * 刻意与 `./index.ts` 分开：那里持有 MMKV 与 jotai 状态，而这些常量既被 UI、
 * 也被原生控制器和测试使用，不应该为了读一个频率表就把存储层拖进依赖图。
 */

/**
 * 频段中心频率（Hz），与 UI 行一一对应。
 *
 * 这十个频点**必须与底层 DSP 一致**：Nitro 的 `EqualizerCore` 使用标准十段
 * 31/63/125/250/500/1k/2k/4k/8k/16k。此前 UI 用的是另一组五段频点，
 * 那时控制器是 no-op 所以无所谓；接上真实 DSP 后若不一致，滑杆标注的频率
 * 就会与实际生效的频段对不上——那等于换一种方式骗用户。
 * `__tests__/equalizerBands.test.ts` 直接对着 Nitro 源码校验这一点。
 */
export const EQUALIZER_BANDS: { freq: number; label: string }[] = [
    { freq: 31, label: "31" },
    { freq: 63, label: "63" },
    { freq: 125, label: "125" },
    { freq: 250, label: "250" },
    { freq: 500, label: "500" },
    { freq: 1000, label: "1k" },
    { freq: 2000, label: "2k" },
    { freq: 4000, label: "4k" },
    { freq: 8000, label: "8k" },
    { freq: 16000, label: "16k" },
];

/** 增益范围（dB），与 Nitro 文档一致；超出会被原生静默截断。 */
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

export const FLAT_GAINS = EQUALIZER_BANDS.map(() => 0);

/** 预设（增益数组长度需与 EQUALIZER_BANDS 一致，即十段） */
export const EQUALIZER_PRESETS: IEqualizerPreset[] = [
    //             31  63 125 250 500  1k  2k  4k  8k 16k
    { id: "flat", label: "默认", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: "pop", label: "流行", gains: [-1, -1, 0, 2, 4, 4, 2, 0, -1, -1] },
    { id: "rock", label: "摇滚", gains: [5, 4, 2, 0, -1, 0, 2, 3, 4, 4] },
    { id: "classic", label: "古典", gains: [4, 3, 2, 0, 0, 0, 1, 2, 3, 4] },
    { id: "bass", label: "重低音", gains: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0] },
    { id: "vocal", label: "人声", gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
    { id: "treble", label: "高音", gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
];

export const CUSTOM_PRESET_ID = "custom";

/** 底层音频引擎适配器：UI 只依赖这个接口，不关心具体实现 */
export interface IEqualizerController {
    setEnabled(enabled: boolean): void;
    setGains(gains: number[]): void;
}

/**
 * 当前后端是否支持均衡器。
 *
 * 效果器挂在播放器的音频会话上（Android `DynamicsProcessing` / iOS
 * `AVAudioUnitEQ`），MPV 有独立音频链路、不经过该会话，因此在 MPV 下无效。
 * UI 入口与控制器注入共用这一个判断，避免两处口径不一致。
 */
export function isEqualizerSupported(playerBackend: unknown) {
    return playerBackend !== "mpv";
}

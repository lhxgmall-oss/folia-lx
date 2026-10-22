// Copyright (c) 2026 chthollyphile
import { numberWithin } from '../tuningDefinition';
import { DEFAULT_HANABI_TUNING, type HanabiTuning } from './types';

// src/components/visualizer/hanabi/hanabiTuning.ts
// 花火 tuning 的归一化与运行时分类：存档、导入、同步、滑块拖动都经 normalizeHanabiTuning 补齐字段、钳住范围；
// 运行时按 HANABI_LIVE_KEYS 区分「每帧现读、改了立刻生效」与「烘焙进场景、改了要重建」的字段。

const COLOR_MODES: HanabiTuning['colorMode'][] = ['theme', 'vivid', 'mixed'];

/** 任何存下来的值 → 完整、合法的 tuning（缺字段走默认，越界钳住）。 */
export const normalizeHanabiTuning = (raw: unknown): HanabiTuning => {
    const input = { ...DEFAULT_HANABI_TUNING, ...(raw && typeof raw === 'object' ? raw as Partial<HanabiTuning> : {}) };
    const d = DEFAULT_HANABI_TUNING;
    return {
        colorMode: COLOR_MODES.includes(input.colorMode) ? input.colorMode : d.colorMode,
        sparkAmount: numberWithin(input.sparkAmount, d.sparkAmount, 0, 2),
        ornamentAmount: numberWithin(input.ornamentAmount, d.ornamentAmount, 0, 2),
        textMotion: numberWithin(input.textMotion, d.textMotion, 0, 2),
        blockOpacity: numberWithin(input.blockOpacity, d.blockOpacity, 0, 1),
        riseSpeed: numberWithin(input.riseSpeed, d.riseSpeed, 0, 2),
        spin: numberWithin(input.spin, d.spin, 0, 2),
        ambient: numberWithin(input.ambient, d.ambient, 0, 2),
        glow: numberWithin(input.glow, d.glow, 0, 2),
        bloom: numberWithin(input.bloom, d.bloom, 0, 2),
        chorusBloom: numberWithin(input.chorusBloom, d.chorusBloom, 0, 2),
        launches: input.launches !== false,
        overlayFrame: input.overlayFrame !== false,
        textOnly: input.textOnly === true,
        sky: numberWithin(input.sky, d.sky, 0, 1),
        collage: numberWithin(input.collage, d.collage, 0, 2),
    };
};

/** 每帧现读、改了不用重建场景的字段（夜空、全屏辉光）；画框另由 HANABI_OVERLAY_KEYS 决定是否重画。 */
const HANABI_LIVE_KEYS: ReadonlyArray<keyof HanabiTuning> = ['sky', 'overlayFrame', 'bloom', 'chorusBloom'];
/** 改了要重画画框的字段。 */
export const HANABI_OVERLAY_KEYS: ReadonlyArray<keyof HanabiTuning> = ['overlayFrame', 'colorMode', 'textOnly'];

/** 两份 tuning 之间有没有烘焙进场景的字段变了（变了就防抖重建场景与片尾卡）。 */
export const requiresHanabiSceneRebuild = (previous: HanabiTuning, next: HanabiTuning) => (
    (Object.keys(next) as Array<keyof HanabiTuning>).some(key => !HANABI_LIVE_KEYS.includes(key) && previous[key] !== next[key])
);

export const changedHanabiKeys = (previous: HanabiTuning, next: HanabiTuning, keys: ReadonlyArray<keyof HanabiTuning>) => (
    keys.some(key => previous[key] !== next[key])
);

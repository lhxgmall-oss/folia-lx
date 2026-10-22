// Copyright (c) 2026 chthollyphile
import { describe, expect, it } from 'vitest';
import { normalizeHanabiTuning, requiresHanabiSceneRebuild } from '@/components/visualizer/hanabi/hanabiTuning';
import { DEFAULT_HANABI_TUNING } from '@/components/visualizer/hanabi/types';

// test/unit/visualizer/hanabi/hanabiTuning.test.ts
// 花火 tuning 的归一化：补齐缺的字段、钳住范围、拒绝不认识的配色；以及哪些字段改了要重建场景。

describe('花火 tuning 的归一化', () => {
    it('不是对象时整份用默认值', () => {
        for (const raw of [undefined, null, 5, 'text', true]) expect(normalizeHanabiTuning(raw)).toEqual(DEFAULT_HANABI_TUNING);
        expect(normalizeHanabiTuning({})).toEqual(DEFAULT_HANABI_TUNING);
    });

    it('缺的字段补默认值，给了的留着', () => {
        const tuning = normalizeHanabiTuning({ sparkAmount: 1.5, launches: false });
        expect(tuning).toEqual({ ...DEFAULT_HANABI_TUNING, sparkAmount: 1.5, launches: false });
        expect(Object.keys(tuning).sort()).toEqual(Object.keys(DEFAULT_HANABI_TUNING).sort());
    });

    it('数值钳在范围里，不是数的退回默认值', () => {
        const high = normalizeHanabiTuning({
            sparkAmount: 9, ornamentAmount: 9, textMotion: 9, blockOpacity: 9, riseSpeed: 9, ambient: 9, glow: 9, sky: 9, collage: 9,
        });
        expect(high).toMatchObject({
            sparkAmount: 2, ornamentAmount: 2, textMotion: 2, blockOpacity: 1, riseSpeed: 2, ambient: 2, glow: 2, sky: 1, collage: 2,
        });
        const low = normalizeHanabiTuning({
            sparkAmount: -1, ornamentAmount: -1, textMotion: -1, blockOpacity: -1, riseSpeed: -1, ambient: -1, glow: -1, sky: -1, collage: -1,
        });
        expect(low).toMatchObject({
            sparkAmount: 0, ornamentAmount: 0, textMotion: 0, blockOpacity: 0, riseSpeed: 0, ambient: 0, glow: 0, sky: 0, collage: 0,
        });
        const wrong = normalizeHanabiTuning({ sparkAmount: '1.5', sky: null, glow: Number.NaN });
        expect(wrong).toMatchObject({ sparkAmount: DEFAULT_HANABI_TUNING.sparkAmount, sky: DEFAULT_HANABI_TUNING.sky, glow: DEFAULT_HANABI_TUNING.glow });
    });

    it('配色只认 theme / vivid / mixed', () => {
        for (const colorMode of ['theme', 'vivid', 'mixed'] as const) expect(normalizeHanabiTuning({ colorMode }).colorMode).toBe(colorMode);
        for (const colorMode of ['neon', '', 3, null]) expect(normalizeHanabiTuning({ colorMode }).colorMode).toBe(DEFAULT_HANABI_TUNING.colorMode);
    });

    it('开关：launches / overlayFrame 只有 false 才关，textOnly 只有 true 才开', () => {
        expect(normalizeHanabiTuning({ launches: 0, overlayFrame: 'no', textOnly: 'yes' })).toMatchObject({ launches: true, overlayFrame: true, textOnly: false });
        expect(normalizeHanabiTuning({ launches: false, overlayFrame: false, textOnly: true })).toMatchObject({ launches: false, overlayFrame: false, textOnly: true });
    });

    it('归一化是幂等的', () => {
        const once = normalizeHanabiTuning({ sparkAmount: 9, colorMode: 'neon', sky: 0.3 });
        expect(normalizeHanabiTuning(once)).toEqual(once);
    });
});

describe('花火 tuning 改了要不要重建场景', () => {
    it('夜空与画框每帧现读，不重建；其余字段改了要重建', () => {
        const base = DEFAULT_HANABI_TUNING;
        expect(requiresHanabiSceneRebuild(base, { ...base })).toBe(false);
        expect(requiresHanabiSceneRebuild(base, { ...base, sky: 0.2 })).toBe(false);
        expect(requiresHanabiSceneRebuild(base, { ...base, overlayFrame: !base.overlayFrame })).toBe(false);
        expect(requiresHanabiSceneRebuild(base, { ...base, sparkAmount: 1.7 })).toBe(true);
        expect(requiresHanabiSceneRebuild(base, { ...base, colorMode: 'theme' })).toBe(true);
    });
});

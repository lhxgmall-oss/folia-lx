import { describe, expect, it } from 'vitest';
import { cubicBezier } from 'framer-motion';
import { BRAVAIS_REFLOW_EASE } from '@/library/suites/bravais/bravaisConstants';
import { isReflowSettled, sampleReflowRect, type ReflowChannel } from '@/library/suites/bravais/bravaisReflowMotion';

// test/unit/library/bravais/bravaisReflowMotion.test.ts
// 聚焦卡让位时块底板按过渡参数推算窗磁贴的实时矩形（B12b）：起止值 + 缓动 + 动画的 currentTime，
// 不读样式；被取消 / 放完的按终点；没有过渡的属性取落定矩形。

const ease = cubicBezier(...BRAVAIS_REFLOW_EASE);
const animation = (currentTime: number | null, playState: AnimationPlayState = 'running') => ({ currentTime, playState });
const target = { x: 300, y: 200, width: 120, height: 80 };

const channels = (time: number | null, playState?: AnimationPlayState, duration = 500): ReflowChannel[] => [
    { property: 'transform', from: [100, 40], to: [300, 200], duration, delay: 0, animation: animation(time, playState) },
    { property: 'width', from: [248], to: [120], duration, delay: 0, animation: animation(time, playState) },
];

describe('sampleReflowRect', () => {
    it('starts at the transition start values', () => {
        expect(sampleReflowRect(channels(0), target)).toEqual({ x: 100, y: 40, width: 248, height: 80 });
        // 开始时间还没定（pending）时 currentTime 为 null：画在起点。
        expect(sampleReflowRect(channels(null), target)).toEqual({ x: 100, y: 40, width: 248, height: 80 });
    });

    it('follows the reflow easing (with its overshoot)', () => {
        const eased = ease(0.6);
        expect(eased).toBeGreaterThan(1);
        const rect = sampleReflowRect(channels(300), target);
        expect(rect.x).toBeCloseTo(100 + 200 * eased, 6);
        expect(rect.y).toBeCloseTo(40 + 160 * eased, 6);
        expect(rect.width).toBeCloseTo(248 - 128 * eased, 6);
        expect(rect.height).toBe(80);
    });

    it('honours a shortened duration (a reversed transition)', () => {
        const rect = sampleReflowRect(channels(150, 'running', 300), target);
        expect(rect.x).toBeCloseTo(100 + 200 * ease(0.5), 6);
    });

    it('lands on the end values once finished or cancelled', () => {
        expect(sampleReflowRect(channels(500), target)).toEqual(target);
        expect(sampleReflowRect(channels(120, 'finished'), target)).toEqual(target);
        expect(sampleReflowRect(channels(null, 'idle'), target)).toEqual(target);
    });
});

describe('isReflowSettled', () => {
    it('is settled only when every channel has run out', () => {
        expect(isReflowSettled(channels(499))).toBe(false);
        expect(isReflowSettled(channels(500))).toBe(true);
        expect(isReflowSettled([...channels(500), ...channels(100, 'running', 300)])).toBe(false);
        expect(isReflowSettled([])).toBe(true);
    });
});

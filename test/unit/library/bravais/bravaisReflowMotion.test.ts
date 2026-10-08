import { describe, expect, it } from 'vitest';
import { BRAVAIS_REFLOW_MS, bravaisReflowEase as ease, isReflowSettled, sampleReflowRect, type ReflowChannel } from '@/library/suites/bravais/bravaisReflowMotion';
import { wallReflowSettleMs } from '@/components/wall/wallReflowMotion';

// test/unit/library/bravais/bravaisReflowMotion.test.ts
// 聚焦卡让位时块底板按过渡参数推算窗磁贴的实时矩形（B12b）：起止值 + 缓动 + 动画的 currentTime，
// 不读样式；被取消 / 放完的按终点；没有过渡的属性取落定矩形。缓动是 Lattice 的让位弹簧（不过冲）。
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

    it('follows the reflow easing (the Lattice spring, no overshoot)', () => {
        const eased = ease(0.6);
        expect(eased).toBeGreaterThan(0.9);
        expect(eased).toBeLessThan(1);
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

describe('reflow timing', () => {
    it('lasts as long as the Lattice spring takes to settle a move across a whole block, and never overshoots', () => {
        // 12 列 × (128 + 8) − 8 = 1624 世界单位。
        expect(BRAVAIS_REFLOW_MS).toBe(wallReflowSettleMs(1624));
        expect(BRAVAIS_REFLOW_MS).toBeGreaterThan(600);
        expect(BRAVAIS_REFLOW_MS).toBeLessThan(700);
        let previous = 0;
        for (let step = 0; step <= 200; step += 1) {
            const value = ease(step / 200);
            expect(value).toBeGreaterThanOrEqual(previous);
            expect(value).toBeLessThanOrEqual(1);
            previous = value;
        }
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

// Copyright (c) 2026 chthollyphile
import { describe, expect, it } from 'vitest';
import { compileHanabiProgram } from '@/components/visualizer/hanabi/hanabiProgram';
import { resolveHanabiSceneFrames } from '@/components/visualizer/hanabi/hanabiSceneFrames';
import { HANABI_TRANSITIONS, resolveHanabiEnterDuration } from '@/components/visualizer/hanabi/hanabiTransitions';
import { syntheticSong } from '../lumiere/lumiereFixtures';

// test/unit/visualizer/hanabi/hanabiSceneFrames.test.ts
// 花火某一时刻画哪些段落场景：转场之外只有当前段一层、不透明；进入窗口里上一段与新段交叉渐变；静态模式永远一层。

const programs = [
    compileHanabiProgram(syntheticSong(1), 'frames', {}, { duration: 160 }),
    compileHanabiProgram(syntheticSong(11), 'frames-2', {}, { duration: 140 }),
    ...Array.from({ length: 4 }, (_, index) => compileHanabiProgram([], `frames-${index}`)),
];

const enterWindow = (program: typeof programs[number], index: number) => {
    const out = program.paragraphs[index - 1]!.transitionOut!;
    return { kind: out.kind, start: program.paragraphs[index]!.startTime, duration: resolveHanabiEnterDuration(out.kind, out.startTime, out.endTime) };
};

describe('花火的段落场景帧', () => {
    it('转场之外：只有当前段一层，不透明、不缩放、不模糊', () => {
        let checked = 0;
        for (const program of programs) {
            program.paragraphs.forEach((paragraph, index) => {
                const from = index > 0 ? enterWindow(program, index).start + enterWindow(program, index).duration : paragraph.startTime;
                const to = paragraph.transitionOut?.startTime ?? paragraph.endTime;
                if (to - from < 0.1) return;
                for (const time of [from + 0.01, (from + to) / 2, to - 0.01]) {
                    const frames = resolveHanabiSceneFrames(program, time, true);
                    expect(frames.activeIndex).toBe(index);
                    expect(frames.layers).toEqual([{ index, alpha: 1, scale: 1, blur: 0, y: 0, rotation: 0 }]);
                    checked += 1;
                }
            });
        }
        expect(checked).toBeGreaterThan(30);
    });

    it('出场窗口里当前段套出场帧，仍是一层', () => {
        const program = programs[2]!;
        const paragraph = program.paragraphs[0]!;
        const out = paragraph.transitionOut!;
        const time = (out.startTime + out.endTime) / 2;
        const frames = resolveHanabiSceneFrames(program, time, true);
        expect(frames.layers).toHaveLength(1);
        const expected = HANABI_TRANSITIONS[out.kind].resolveFrame('exit', 0.5);
        const layer = frames.layers[0]!;
        expect(layer.index).toBe(0);
        for (const key of ['alpha', 'scale', 'blur', 'y'] as const) expect(layer[key], key).toBeCloseTo(expected[key], 6);
        expect(layer.y !== 0 || layer.scale !== 1 || layer.blur !== 0).toBe(true);
    });

    it('进入窗口里上一段与新段交叉渐变：上一段越来越淡，新段越来越实', () => {
        const kinds = new Set<string>();
        for (const program of programs) {
            for (let index = 1; index < program.paragraphs.length; index += 1) {
                const { kind, start, duration } = enterWindow(program, index);
                kinds.add(kind);
                let previousAlpha = Infinity;
                let currentAlpha = -Infinity;
                for (const progress of [0.05, 0.25, 0.5, 0.75, 0.95]) {
                    const frames = resolveHanabiSceneFrames(program, start + duration * progress, true);
                    expect(frames.activeIndex).toBe(index);
                    const current = frames.layers.at(-1)!;
                    expect(current.index).toBe(index);
                    expect(current.alpha).toBeGreaterThan(currentAlpha);
                    currentAlpha = current.alpha;
                    if (kind === 'bloom') {
                        // 开花的出场终点是全透明：上一段不再画。
                        expect(frames.layers).toHaveLength(1);
                        continue;
                    }
                    if (progress < 0.9) {
                        expect(frames.layers).toHaveLength(2);
                        const previous = frames.layers[0]!;
                        expect(previous.index).toBe(index - 1);
                        expect(previous.alpha).toBeLessThan(previousAlpha);
                        previousAlpha = previous.alpha;
                    }
                }
                // 进入窗口刚结束：回到一层、不透明。
                const after = resolveHanabiSceneFrames(program, start + duration + 1e-3, true);
                expect(after.layers).toHaveLength(1);
                expect(after.layers[0]!.index).toBe(index);
            }
        }
        expect(kinds.has('ascend')).toBe(true);
    });

    it('静态模式（不放转场）任何时刻都只有当前段一层、不透明', () => {
        for (const program of programs) {
            for (let time = -1; time < program.duration + 1; time += 0.37) {
                const frames = resolveHanabiSceneFrames(program, time, false);
                expect(frames.layers).toHaveLength(1);
                expect(frames.layers[0]).toEqual({ index: frames.activeIndex, alpha: 1, scale: 1, blur: 0, y: 0, rotation: 0 });
            }
        }
    });

    it('没有段落时不画', () => {
        const empty = { ...programs[0]!, paragraphs: [] };
        expect(resolveHanabiSceneFrames(empty, 3, true)).toEqual({ activeIndex: -1, layers: [] });
    });
});

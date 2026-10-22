import { describe, expect, it } from 'vitest';
import { buildTimeline, type TimelineShot } from '@/components/visualizer/hanabi/timeline';

// test/unit/visualizer/hanabi/hanabiSpin.test.ts
// 花火的世界旋转：贯穿整个单元一直在转——镜头内慢转、镜头边界加速转过大角度，位置与角速度都连续；
// 同一方向时没有停住的阶段，换向时只在一瞬间过零；镜头中点时正好转到这个镜头自己的角度（字是正的）。

const shots: TimelineShot[] = Array.from({ length: 6 }, (_, index) => ({
    startTime: index * 3,
    endTime: (index + 1) * 3,
    firstSung: index * 3 + 0.2,
    lastSungEnd: index * 3 + 2.6,
    isBridge: false,
    camera: { rise: 0.4, push: 0.05, roll: 0, punch: 0 },
}));

const build = (directions: number[]) => {
    const angles: number[] = [];
    const drift: number[] = [];
    directions.forEach((direction, index) => {
        angles.push(index === 0 ? 0 : angles[index - 1]! + direction * 1.1);
        drift.push(direction * 0.12);
    });
    const timeline = buildTimeline(shots, { unitStart: 0, unitEnd: 18, height: 720, riseSpeed: 1, motion: 1, spinAngles: angles, spinDrift: drift });
    return { timeline, angles };
};

const FRAME = 1 / 120;

/** 逐帧的角速度（弧度 / 秒）。 */
const velocities = (spin: (time: number) => number) => {
    const out: number[] = [];
    for (let time = 0.05; time < 17.95; time += FRAME) out.push((spin(time + FRAME) - spin(time)) / FRAME);
    return out;
};

describe('花火的世界旋转', () => {
    it('镜头中点时转到这个镜头自己的角度', () => {
        const { timeline, angles } = build([1, 1, 1, 1, 1, 1]);
        shots.forEach((shot, index) => {
            expect(timeline.spin((shot.startTime + shot.endTime) / 2)).toBeCloseTo(angles[index]!, 6);
        });
    });

    it('同一方向时一直在转：角速度处处同号、不低于镜头内的慢转', () => {
        const { timeline } = build([1, 1, 1, 1, 1, 1]);
        const speeds = velocities(timeline.spin);
        expect(Math.min(...speeds)).toBeGreaterThan(0.12 * 0.9);
        // 边界的快转比镜头内的慢转快得多。
        expect(Math.max(...speeds)).toBeGreaterThan(1);
    });

    it('角度连续、没有跳变', () => {
        const { timeline } = build([1, -1, -1, 1, 1, -1]);
        for (let time = 0.05; time < 17.95; time += FRAME) {
            expect(Math.abs(timeline.spin(time + FRAME) - timeline.spin(time))).toBeLessThan(0.05);
        }
    });

    it('换向时只在一瞬间过零，没有停住的一段', () => {
        const { timeline } = build([1, -1, -1, 1, 1, -1]);
        const speeds = velocities(timeline.spin);
        let run = 0;
        let longest = 0;
        speeds.forEach(speed => {
            run = Math.abs(speed) < 0.05 ? run + 1 : 0;
            longest = Math.max(longest, run);
        });
        // 慢于 0.05 弧度 / 秒（约 3°/秒）的连续时间不超过 0.05 秒。
        expect(longest * FRAME).toBeLessThan(0.05);
    });

    it('不给角度时不转', () => {
        const timeline = buildTimeline(shots, { unitStart: 0, unitEnd: 18, height: 720, riseSpeed: 1, motion: 1 });
        [0, 2.9, 3.1, 9, 17].forEach(time => expect(timeline.spin(time)).toBe(0));
    });
});

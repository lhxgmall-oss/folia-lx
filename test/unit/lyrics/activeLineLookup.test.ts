import { describe, expect, it } from 'vitest';
import { createActiveLineLookup, findLatestActiveLineIndex } from '../../../src/utils/lyrics/activeLineLookup';

// test/unit/lyrics/activeLineLookup.test.ts

type TimedLine = Parameters<typeof createActiveLineLookup>[0][number];
const line = (startTime: number, endTime: number, renderEndTime?: number): TimedLine => ({
    startTime, endTime,
    ...(renderEndTime === undefined ? {} : { renderHints: {
        rawDuration: endTime - startTime, timingClass: 'normal', renderEndTime,
        lineTransitionMode: 'normal', wordRevealMode: 'normal',
    } as const }),
});

describe('activeLineLookup', () => {
    it('includes exact start/end boundaries and leaves interludes empty', () => {
        const lookup = createActiveLineLookup([line(1, 2), line(4, 5)]);
        for (const [time, index] of [[0, -1], [1, 0], [2, 0], [2.001, -1], [4, 1], [5, 1], [5.001, -1]]) {
            expect(lookup(time)).toBe(index);
        }
        expect(createActiveLineLookup([])(2)).toBe(-1);
    });

    it('keeps reverse-array precedence for overlaps, equal starts and render tails', () => {
        const lookup = createActiveLineLookup([line(0, 8), line(1, 2, 4), line(1, 1.5)]);
        expect(lookup(1)).toBe(2);
        expect(lookup(1.5)).toBe(2);
        expect(lookup(2)).toBe(1);
        expect(lookup(4)).toBe(1);
        expect(lookup(4.001)).toBe(0);
    });

    it('supports backward seeks, loop restarts and replacement lyrics', () => {
        const lookup = createActiveLineLookup([line(0, 2), line(3, 5), line(7, 9)]);
        expect([8, 0, 4, 1, 9, 6, 0].map(lookup)).toEqual([2, 0, 1, 0, 2, -1, 0]);
        expect(createActiveLineLookup([line(0, 9)])(8)).toBe(0);
    });

    it('preserves the existing behavior for unsorted and non-finite inputs', () => {
        for (const lines of [[line(3, 7), line(0, 8)], [line(0, Infinity)], [line(NaN, 8)]]) {
            const lookup = createActiveLineLookup(lines);
            for (const time of [0, 3, 7, 8, 9, NaN, Infinity, -Infinity]) {
                expect(lookup(time)).toBe(findLatestActiveLineIndex(lines, time));
            }
        }
    });

    it('matches the original search across a long timeline, including random seeks', () => {
        let seed = 17;
        const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
        const lines = Array.from({ length: 1200 }, (_, index) => line(index * 0.5, index * 0.5 + random() * 5));
        const lookup = createActiveLineLookup(lines);
        for (const entry of lines) {
            for (const time of [entry.startTime, entry.endTime, entry.endTime + 0.0001]) {
                expect(lookup(time)).toBe(findLatestActiveLineIndex(lines, time));
            }
        }
        for (let index = 0; index < 3000; index += 1) {
            const time = random() * 650 - 10;
            expect(lookup(time)).toBe(findLatestActiveLineIndex(lines, time));
        }
    });

    it('does not read the lyric objects again on every frame', () => {
        let reads = 0;
        const lines = Array.from({ length: 5000 }, (_, index) => ({
            get startTime() { reads += 1; return index * 2; },
            get endTime() { reads += 1; return index * 2 + 1; },
        }));
        const lookup = createActiveLineLookup(lines);
        reads = 0;
        for (let frame = 0; frame < 1000; frame += 1) lookup(frame / 60);
        expect(reads).toBe(0);
    });
});

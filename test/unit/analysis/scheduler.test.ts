import { describe, expect, it } from 'vitest';
import { chooseCpuThreads, chooseExecutor, cpuThreads, createScheduler, DEADLINE_MARGIN_MS, type UnitRequest } from '@/services/analysis/scheduler';

// test/unit/analysis/scheduler.test.ts
// The analysis scheduler: which unit runs next (deadline by slack, then on screen, then background,
// first come first served), a dropped task answering null at its turn, a paused one passed over and
// kept, the estimate a task's finish is judged by, and the GPU / CPU and thread-level choices.

const clock = () => {
    let at = 0;
    return { now: () => at, advance: (ms: number) => { at += ms; } };
};

/** A unit that answers when told, recording when it started. */
const held = (name: string, started: string[]) => {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    return {
        run: async () => { started.push(name); await done; return name; },
        finish: () => finish(),
    };
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the scheduler', () => {
    it('runs a deadline first, then what is on screen, then background, in order within each', async () => {
        const time = clock();
        const scheduler = createScheduler({ now: time.now, log: () => undefined });
        const started: string[] = [];
        const first = held('first', started);
        const units: Record<string, ReturnType<typeof held>> = {};
        const submit = (name: string, request: Omit<UnitRequest<string>, 'run' | 'kind'>) => {
            units[name] = held(name, started);
            return scheduler.submit({ ...request, kind: 'htdemucs', run: units[name].run });
        };
        // Busy with one, so the rest queue.
        const busy = scheduler.submit({ kind: 'htdemucs', urgency: 'background', run: first.run });
        const answers = [
            submit('background-1', { urgency: 'background' }),
            submit('screen', { urgency: 'onScreen' }),
            submit('background-2', { urgency: 'background' }),
            submit('late', { urgency: 'transition', deadline: 60_000 }),
            submit('later', { urgency: 'transition', deadline: 600_000 }),
        ];
        expect(scheduler.queued()).toBe(5);
        first.finish();
        await busy;
        for (const name of ['late', 'later', 'screen', 'background-1', 'background-2']) {
            await flush();
            units[name].finish();
        }
        await Promise.all(answers);
        expect(started).toEqual(['first', 'late', 'later', 'screen', 'background-1', 'background-2']);
    });

    it('drops a unit whose task is no longer wanted when its turn comes, and passes a paused one over', async () => {
        const scheduler = createScheduler({ log: () => undefined });
        const started: string[] = [];
        const first = held('first', started);
        let wanted = true;
        let paused = true;
        const busy = scheduler.submit({ kind: 'beat_this', urgency: 'onScreen', run: first.run });
        const left = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', stillWanted: () => wanted, run: async () => 'left' });
        const resumed = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', paused: () => paused, run: async () => 'resumed' });
        const other = scheduler.submit({ kind: 'beat_this', urgency: 'background', run: async () => 'other' });
        wanted = false;
        first.finish();
        await busy;
        expect(await left).toBeNull();
        expect(await other).toBe('other');
        // Still queued, until it is resumed and something moves the queue.
        expect(scheduler.queued()).toBe(1);
        paused = false;
        expect(await scheduler.submit({ kind: 'percussive', urgency: 'background', run: async () => 'nudge' })).toBe('nudge');
        expect(await resumed).toBe('resumed');
    });

    it('measures each kind, and estimates a finish from what is ahead, the units left and a load', async () => {
        const time = clock();
        let loaded = false;
        const scheduler = createScheduler({ now: time.now, isLoaded: () => loaded, log: () => undefined });
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { time.advance(200); return 1; } });
        expect(scheduler.unitMs('htdemucs')).toBe(200);
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { time.advance(100); return 1; } });
        // A moving average, weighted to the newer.
        expect(scheduler.unitMs('htdemucs')).toBeCloseTo(180);
        scheduler.noteLoad('htdemucs', 1000);
        expect(scheduler.estimateFinish('htdemucs', 10, 'transition', 60_000)).toBeCloseTo(time.now() + 1800 + 1000);
        loaded = true;
        expect(scheduler.estimateFinish('htdemucs', 10, 'transition', 60_000)).toBeCloseTo(time.now() + 1800);
    });

    it('counts the units picked before a task, not those after it', async () => {
        const time = clock();
        const scheduler = createScheduler({ now: time.now, log: () => undefined });
        const started: string[] = [];
        const first = held('first', started);
        const busy = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: first.run });
        const behind = scheduler.submit({ kind: 'beat_this', urgency: 'background', run: async () => 'x' });
        const ahead = scheduler.submit({ kind: 'beat_this', urgency: 'onScreen', run: async () => 'y' });
        // What is left of the running unit (none of it has passed on this clock), then: on screen, the
        // on-screen unit is ahead of it (first come) and the background one is not.
        const runningLeft = scheduler.unitMs('htdemucs');
        expect(scheduler.estimateFinish('htdemucs', 1, 'onScreen')).toBeCloseTo(runningLeft + scheduler.unitMs('beat_this') + scheduler.unitMs('htdemucs'));
        // A deadline goes before both.
        expect(scheduler.estimateFinish('htdemucs', 1, 'transition', 1e9)).toBeCloseTo(runningLeft + scheduler.unitMs('htdemucs'));
        first.finish();
        await Promise.all([busy, behind, ahead]);
    });
});

describe('the scheduler, from review', () => {
    it('lets a background unit that has waited a second in before the next on-screen one', async () => {
        const time = clock();
        const scheduler = createScheduler({ now: time.now, log: () => undefined });
        const started: string[] = [];
        const segment = held('segment-1', started);
        const busy = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: segment.run });
        const automix = scheduler.submit({ kind: 'beat_this', urgency: 'background', run: async () => { started.push('automix'); return 'automix'; } });
        time.advance(1500);
        // The separation asks for its next segment as the last one answers.
        const next = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { started.push('segment-2'); return 'segment-2'; } });
        segment.finish();
        await Promise.all([busy, automix, next]);
        expect(started).toEqual(['segment-1', 'automix', 'segment-2']);
    });

    it('raises a track\'s queued units when a caller on screen joins them', async () => {
        const scheduler = createScheduler({ log: () => undefined });
        const started: string[] = [];
        const first = held('first', started);
        const busy = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: first.run });
        const joined = scheduler.submit({ kind: 'beat_this', key: 'song-1', urgency: 'background', run: async () => { started.push('song-1'); return 1; } });
        const screen = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { started.push('screen'); return 2; } });
        scheduler.raise('song-1', 'onScreen');
        first.finish();
        await Promise.all([busy, joined, screen]);
        expect(started).toEqual(['first', 'song-1', 'screen']);
    });

    it('runs a resumed unit on wake, with nothing else queued', async () => {
        const scheduler = createScheduler({ log: () => undefined });
        let paused = true;
        const answer = scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', paused: () => paused, run: async () => 'resumed' });
        await flush();
        expect(scheduler.queued()).toBe(1);
        paused = false;
        scheduler.wake();
        expect(await answer).toBe('resumed');
    });

    it('takes a load off the unit it happened in, and does not time a run that answered nothing', async () => {
        const time = clock();
        const scheduler = createScheduler({ now: time.now, log: () => undefined });
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { time.advance(1000); scheduler.noteLoad('htdemucs', 1000); time.advance(150); return 1; } });
        expect(scheduler.unitMs('htdemucs')).toBe(150);
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => null });
        expect(scheduler.unitMs('htdemucs')).toBe(150);
    });

    it('does not stay busy after a run that throws before its first await', async () => {
        const scheduler = createScheduler({ log: () => undefined });
        await expect(scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: () => { throw new Error('sync'); } })).rejects.toThrow('sync');
        expect(await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => 'after' })).toBe('after');
    });
});

describe('where and how hard a task runs', () => {
    it('takes the GPU unless it is missing or late, and then the CPU only if that is on time', () => {
        expect(chooseExecutor({ gpuAvailable: false, gpuFinish: 0, cpuFinish: 0 })).toBe('cpu');
        expect(chooseExecutor({ gpuAvailable: true, gpuFinish: 1e9, cpuFinish: 0 })).toBe('gpu');
        expect(chooseExecutor({ gpuAvailable: true, deadline: 60_000, gpuFinish: 1000, cpuFinish: 0 })).toBe('gpu');
        expect(chooseExecutor({ gpuAvailable: true, deadline: 60_000, gpuFinish: 59_000, cpuFinish: 20_000 })).toBe('cpu');
        expect(chooseExecutor({ gpuAvailable: true, deadline: 60_000, gpuFinish: 59_000, cpuFinish: 70_000 })).toBe('gpu');
    });

    it('sizes the CPU threads by the machine: a quarter, htdemucs at most four, half in a hurry', () => {
        expect([24, 10, 8, 4, 2].map(cores => cpuThreads(cores, 'quiet', 'htdemucs'))).toEqual([4, 2, 2, 1, 1]);
        expect([24, 10, 8, 4].map(cores => cpuThreads(cores, 'quiet', 'beat_this'))).toEqual([6, 2, 2, 1]);
        expect([24, 10, 8, 4, 1].map(cores => cpuThreads(cores, 'hurry', 'htdemucs'))).toEqual([12, 5, 4, 2, 1]);
    });

    it('hurries only when the quiet level would be late', () => {
        expect(chooseCpuThreads({ quietFinish: 1e9 })).toBe('quiet');
        expect(chooseCpuThreads({ deadline: 60_000, quietFinish: 60_000 - DEADLINE_MARGIN_MS - 1 })).toBe('quiet');
        expect(chooseCpuThreads({ deadline: 60_000, quietFinish: 60_000 })).toBe('hurry');
    });
});

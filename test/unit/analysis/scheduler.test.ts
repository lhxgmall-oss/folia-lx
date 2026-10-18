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
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { time.advance(200); } });
        expect(scheduler.unitMs('htdemucs')).toBe(200);
        await scheduler.submit({ kind: 'htdemucs', urgency: 'onScreen', run: async () => { time.advance(100); } });
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
        // On screen: the on-screen unit is ahead of it (first come), the background one is not.
        expect(scheduler.estimateFinish('htdemucs', 1, 'onScreen')).toBeCloseTo(scheduler.unitMs('beat_this') + scheduler.unitMs('htdemucs'));
        // A deadline goes before both.
        expect(scheduler.estimateFinish('htdemucs', 1, 'transition', 1e9)).toBeCloseTo(scheduler.unitMs('htdemucs'));
        first.finish();
        await Promise.all([busy, behind, ahead]);
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

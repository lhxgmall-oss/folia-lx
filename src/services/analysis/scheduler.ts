// src/services/analysis/scheduler.ts
// The analysis scheduler (docs/analysis-service-plan.md, phase 2): which unit of model work runs next
// on an executor, how long each kind takes there, and so when a task would finish.
//
// A unit is the smallest piece of work an executor takes in one go: an htdemucs segment (3.9 s of
// audio), a beat_this run over a track's chunks, a percussive-energy pass. Work longer than a unit -
// a whole track's separation - is a task that submits its units one at a time, so between any two of
// them another task's unit can go first. That is where priority, dropping and (2b) pausing happen:
// at a unit boundary, never inside one.
//
// Which unit next: those with a deadline (automix's transition) by the least slack - the deadline
// less when they would finish - then what a picture on screen is waiting for, then background work,
// first come first served within each. A unit whose task is no longer wanted is dropped when it
// would have been picked (it answers null); one whose task is paused is passed over and kept.
//
// "Busy" is not a GPU utilisation figure - WebGPU has none - but an estimate: every unit's time is
// measured, kept per kind as a moving average, and a task's finish is now + the units picked before
// it + its own remaining units + a model load if the model is not loaded. A task is behind when that
// is later than its deadline less a margin. `chooseExecutor` and `chooseCpuThreads` make the GPU / CPU
// and thread-level choice from it; they are wired to automix's separation in phase 3, when the GPU
// gives all four stems.
//
// Also measured per unit, for phase 2c (yielding to the picture): the longest gap between two frames
// while the unit ran, against the shortest gap seen (the display's refresh). Only logged here.

export type Urgency = 'transition' | 'onScreen' | 'background';

export interface UnitRequest<T> {
    /** What the unit is, for its timing: 'htdemucs', 'beat_this', 'percussive'. */
    kind: string;
    /** The track it is for, for the log. */
    key?: string;
    urgency: Urgency;
    /** When the task must be done (performance.now() ms); with it, ordered by slack. */
    deadline?: number;
    /** Units the task has left, this one included; for the slack. Defaults to 1. */
    unitsLeft?: number;
    /** Asked when the unit would be picked: false drops it (null). */
    stillWanted?: () => boolean;
    /** Asked when the unit would be picked: true passes it over for now, keeping it queued (2b). */
    paused?: () => boolean;
    run: () => Promise<T>;
}

interface Entry {
    request: UnitRequest<unknown>;
    order: number;
    queuedAt: number;
    settle: (value: unknown) => void;
    fail: (error: unknown) => void;
}

export interface SchedulerOptions {
    now?: () => number;
    /** Whether the model behind `kind` is loaded now, so the estimate adds its load when not. */
    isLoaded?: (kind: string) => boolean;
    /** Frame gaps (ms) while a unit runs, from `watchFrames`; absent in tests and off the renderer. */
    frames?: FrameWatch | null;
    log?: (line: string) => void;
}

/** A unit's or a load's time, before any has been measured: rough M4 figures, replaced by the first measurement. */
const FIRST_GUESS_MS: Record<string, number> = { htdemucs: 190, beat_this: 500, percussive: 50, load: 1500 };
/** Weight of the newest measurement in the moving average. */
const EWMA = 0.2;
const URGENCY_RANK: Record<Urgency, number> = { transition: 0, onScreen: 1, background: 2 };

export interface Scheduler {
    submit<T>(request: UnitRequest<T>): Promise<T | null>;
    /** The moving average of a unit of `kind` (ms), or the first guess. */
    unitMs(kind: string): number;
    /** Records a model load's time for `kind`, which an estimate adds while it is not loaded. */
    noteLoad(kind: string, ms: number): void;
    /** When a task of `units` units of `kind`, at `urgency`, submitted now would finish (ms, `now()` clock). */
    estimateFinish(kind: string, units: number, urgency: Urgency, deadline?: number): number;
    /** Units waiting. */
    queued(): number;
}

export const createScheduler = ({ now = () => performance.now(), isLoaded = () => true, frames = null, log = line => console.info(line) }: SchedulerOptions = {}): Scheduler => {
    const queue: Entry[] = [];
    const averages = new Map<string, number>();
    const loads = new Map<string, number>();
    let busy = false;
    let order = 0;

    const unitMs = (kind: string) => averages.get(kind) ?? FIRST_GUESS_MS[kind] ?? 100;
    const loadMs = (kind: string) => loads.get(kind) ?? FIRST_GUESS_MS.load;
    const slackOf = (request: UnitRequest<unknown>, at: number) => (
        request.deadline === undefined ? Infinity : request.deadline - (at + (request.unitsLeft ?? 1) * unitMs(request.kind))
    );
    /** Negative when `a` goes before `b`. */
    const compare = (a: Entry, b: Entry, at: number) => {
        const deadlineA = a.request.deadline !== undefined;
        const deadlineB = b.request.deadline !== undefined;
        if (deadlineA !== deadlineB) return deadlineA ? -1 : 1;
        if (deadlineA && deadlineB) {
            const bySlack = slackOf(a.request, at) - slackOf(b.request, at);
            if (bySlack !== 0) return bySlack;
        }
        const byUrgency = URGENCY_RANK[a.request.urgency] - URGENCY_RANK[b.request.urgency];
        return byUrgency !== 0 ? byUrgency : a.order - b.order;
    };

    const pick = (): Entry | null => {
        const at = now();
        let best: Entry | null = null;
        for (let index = 0; index < queue.length;) {
            const entry = queue[index];
            if (entry.request.stillWanted && !entry.request.stillWanted()) {
                queue.splice(index, 1);
                entry.settle(null);
                continue;
            }
            index += 1;
            if (entry.request.paused?.()) continue;
            if (!best || compare(entry, best, at) < 0) best = entry;
        }
        if (best) queue.splice(queue.indexOf(best), 1);
        return best;
    };

    const pump = () => {
        if (busy) return;
        const entry = pick();
        if (!entry) return;
        busy = true;
        const { request } = entry;
        const started = now();
        const waited = started - entry.queuedAt;
        frames?.begin();
        // Measured before the caller hears back, so whatever it asks next is estimated with this unit in.
        const finish = () => {
            const took = now() - started;
            const previous = averages.get(request.kind);
            averages.set(request.kind, previous === undefined ? took : previous + EWMA * (took - previous));
            const seen = frames?.end() ?? null;
            // Only the unit worth a look: one that waited, or one the picture dropped frames under.
            if (waited > 200 || (seen && seen.over > 0)) {
                log(`[Scheduler] ${request.kind} ${took.toFixed(0)}ms (${request.urgency}, waited ${waited.toFixed(0)}ms, ${queue.length} queued${request.key ? `, ${request.key}` : ''})`
                    + (seen ? ` | frames: worst ${seen.worst.toFixed(1)}ms over ${seen.refresh.toFixed(1)}ms refresh, ${seen.over} over 1.5x` : ''));
            }
            busy = false;
        };
        void request.run().then(
            (value) => { finish(); entry.settle(value); },
            (error) => { finish(); entry.fail(error); },
        ).finally(pump);
    };

    return {
        submit<T>(request: UnitRequest<T>): Promise<T | null> {
            return new Promise<T | null>((settle, fail) => {
                queue.push({ request: request as UnitRequest<unknown>, order: (order += 1), queuedAt: now(), settle: settle as (value: unknown) => void, fail });
                pump();
            });
        },
        unitMs,
        noteLoad(kind, ms) {
            const previous = loads.get(kind);
            loads.set(kind, previous === undefined ? ms : previous + EWMA * (ms - previous));
        },
        estimateFinish(kind, units, urgency, deadline) {
            const at = now();
            const probe: Entry = { request: { kind, urgency, deadline, unitsLeft: units, run: async () => null }, order: order + 1, queuedAt: at, settle: () => undefined, fail: () => undefined };
            // The units that would be picked before it: one each, as each task has one queued at a time.
            const ahead = queue.filter(entry => !entry.request.paused?.() && compare(entry, probe, at) < 0)
                .reduce((sum, entry) => sum + unitMs(entry.request.kind), 0);
            return at + ahead + units * unitMs(kind) + (isLoaded(kind) ? 0 : loadMs(kind));
        },
        queued: () => queue.length,
    };
};

/** How far ahead of its deadline a task must be estimated to finish to count as on time. */
export const DEADLINE_MARGIN_MS = 5000;

export type Executor = 'gpu' | 'cpu';

/**
 * Where a task runs. Without a usable GPU: the CPU. Without a deadline (智能动感模式): the GPU, which
 * is all it uses. With one (automix): the GPU when it is estimated on time, else the CPU when that is,
 * else the GPU anyway - the transition falls back to the plain crossfade if it is late, as now.
 */
export const chooseExecutor = (
    { gpuAvailable, deadline, gpuFinish, cpuFinish }: { gpuAvailable: boolean; deadline?: number; gpuFinish: number; cpuFinish: number },
): Executor => {
    if (!gpuAvailable) return 'cpu';
    if (deadline === undefined) return 'gpu';
    if (gpuFinish + DEADLINE_MARGIN_MS < deadline) return 'gpu';
    if (cpuFinish + DEADLINE_MARGIN_MS < deadline) return 'cpu';
    return 'gpu';
};

export type CpuThreadLevel = 'quiet' | 'hurry';

/**
 * The CPU threads per level: quiet - a quarter of the logical cores, at least one, htdemucs at most
 * four (the user, 2026-10-17: four fill a four-core machine) - and hurry, about half of them, no
 * more: more was measured slower (electron/analysis/worker.cjs).
 */
export const cpuThreads = (cores: number, level: CpuThreadLevel, model: 'beat_this' | 'htdemucs'): number => {
    const quiet = Math.max(1, Math.floor(cores / 4));
    if (level === 'hurry') return Math.max(quiet, Math.floor(cores / 2));
    return model === 'htdemucs' ? Math.min(4, quiet) : quiet;
};

/** Quiet when it is estimated on time at the quiet level, else hurry. */
export const chooseCpuThreads = ({ deadline, quietFinish }: { deadline?: number; quietFinish: number }): CpuThreadLevel => (
    deadline === undefined || quietFinish + DEADLINE_MARGIN_MS < deadline ? 'quiet' : 'hurry'
);

export interface FrameWatch {
    begin(): void;
    end(): { worst: number; refresh: number; over: number } | null;
}

/**
 * Watches the gaps between frames while a unit runs: the worst one, and how many were over 1.5x the
 * refresh (the shortest gap seen this session). A hidden page has no frames to drop and is not
 * watched. Null off a renderer.
 */
export const watchFrames = (): FrameWatch | null => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return null;
    let refresh = Infinity;
    let handle = 0;
    let last = 0;
    let worst = 0;
    let over = 0;
    let watching = false;
    const step = (at: number) => {
        if (!watching) return;
        if (last) {
            const gap = at - last;
            refresh = Math.min(refresh, gap);
            worst = Math.max(worst, gap);
            if (Number.isFinite(refresh) && gap > refresh * 1.5) over += 1;
        }
        last = at;
        handle = window.requestAnimationFrame(step);
    };
    return {
        begin() {
            if (typeof document !== 'undefined' && document.hidden) return;
            watching = true;
            last = 0;
            worst = 0;
            over = 0;
            handle = window.requestAnimationFrame(step);
        },
        end() {
            if (!watching) return null;
            watching = false;
            window.cancelAnimationFrame(handle);
            return Number.isFinite(refresh) && worst > 0 ? { worst, refresh, over } : null;
        },
    };
};

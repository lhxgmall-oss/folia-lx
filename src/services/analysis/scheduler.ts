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
/**
 * A background unit that has waited this long ranks with what is on screen (first come first served
 * there). Without it a whole track's separation (时计, a unit every segment, some 16 s for four
 * minutes) held automix's beats back for all of it, where the old FIFO let one in between segments.
 */
const BACKGROUND_AGE_MS = 1000;

export interface Scheduler {
    submit<T>(request: UnitRequest<T>): Promise<T | null>;
    /** Raises the queued units of `key` to `urgency`: a caller on screen joined a background run. */
    raise(key: string, urgency: Urgency): void;
    /** Looks at the queue again: a paused unit may have been resumed (2b). */
    wake(): void;
    /** The moving average of a unit of `kind` (ms), or the first guess. */
    unitMs(kind: string): number;
    /**
     * Records a model load's time for `kind`, which an estimate adds while it is not loaded. A load
     * happens inside a unit's run, so it is also taken off that unit's measured time.
     */
    noteLoad(kind: string, ms: number): void;
    /** When a task of `units` units of `kind`, at `urgency`, submitted now would finish (ms, `now()` clock). */
    estimateFinish(kind: string, units: number, urgency: Urgency, deadline?: number): number;
    /** Units waiting. */
    queued(): number;
}

const hasDeadline = (request: UnitRequest<unknown>) => request.deadline !== undefined && Number.isFinite(request.deadline);

export const createScheduler = ({ now = () => performance.now(), isLoaded = () => true, frames = null, log = line => console.info(line) }: SchedulerOptions = {}): Scheduler => {
    const queue: Entry[] = [];
    const averages = new Map<string, number>();
    const loads = new Map<string, number>();
    let busy = false;
    let order = 0;
    /** The unit running: its kind and start, for an estimate's "what is left of it". */
    let running: { kind: string; started: number } | null = null;
    /** Load time noted while the running unit ran, taken off its own time. */
    let loadedDuringUnit = 0;

    const unitMs = (kind: string) => averages.get(kind) ?? FIRST_GUESS_MS[kind] ?? 100;
    const loadMs = (kind: string) => loads.get(kind) ?? FIRST_GUESS_MS.load;
    const slackOf = (request: UnitRequest<unknown>, at: number) => (
        hasDeadline(request) ? request.deadline! - (at + (request.unitsLeft ?? 1) * unitMs(request.kind)) : Infinity
    );
    const rankOf = (entry: Entry, at: number) => (
        entry.request.urgency === 'background' && at - entry.queuedAt >= BACKGROUND_AGE_MS ? URGENCY_RANK.onScreen : URGENCY_RANK[entry.request.urgency]
    );
    /** Negative when `a` goes before `b`. */
    const compare = (a: Entry, b: Entry, at: number) => {
        const deadlineA = hasDeadline(a.request);
        const deadlineB = hasDeadline(b.request);
        if (deadlineA !== deadlineB) return deadlineA ? -1 : 1;
        if (deadlineA && deadlineB) {
            const bySlack = slackOf(a.request, at) - slackOf(b.request, at);
            if (bySlack !== 0) return bySlack;
        }
        const byUrgency = rankOf(a, at) - rankOf(b, at);
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
        running = { kind: request.kind, started };
        loadedDuringUnit = 0;
        frames?.begin();
        // Measured before the caller hears back, so whatever it asks next is estimated with this unit in.
        const finish = (answered: boolean) => {
            const took = now() - started - loadedDuringUnit;
            // A run that answered nothing (no device, a failed model) did no work worth timing.
            if (answered) {
                const previous = averages.get(request.kind);
                averages.set(request.kind, previous === undefined ? took : previous + EWMA * (took - previous));
            }
            const seen = frames?.end() ?? null;
            // Only the unit worth a look: one that waited, or one the picture dropped frames under.
            if (waited > 200 || (seen && seen.over > 0)) {
                log(`[Scheduler] ${request.kind} ${took.toFixed(0)}ms (${request.urgency}, waited ${waited.toFixed(0)}ms, ${queue.length} queued${request.key ? `, ${request.key}` : ''})`
                    + (seen ? ` | frames: worst ${seen.worst.toFixed(1)}ms over ${seen.refresh.toFixed(1)}ms refresh, ${seen.over} over 1.5x` : ''));
            }
            running = null;
            busy = false;
        };
        let pending: Promise<unknown>;
        try {
            pending = request.run();
        } catch (error) {
            // A run that throws before its first await must not leave the scheduler busy for good.
            pending = Promise.reject(error);
        }
        void pending.then(
            (value) => { finish(value !== null && value !== undefined); entry.settle(value); },
            (error) => { finish(false); entry.fail(error); },
        ).finally(pump);
    };

    return {
        submit<T>(request: UnitRequest<T>): Promise<T | null> {
            return new Promise<T | null>((settle, fail) => {
                queue.push({ request: request as UnitRequest<unknown>, order: (order += 1), queuedAt: now(), settle: settle as (value: unknown) => void, fail });
                pump();
            });
        },
        raise(key, urgency) {
            for (const entry of queue) {
                if (entry.request.key === key && URGENCY_RANK[urgency] < URGENCY_RANK[entry.request.urgency]) {
                    entry.request = { ...entry.request, urgency };
                }
            }
        },
        wake: pump,
        unitMs,
        noteLoad(kind, ms) {
            const previous = loads.get(kind);
            loads.set(kind, previous === undefined ? ms : previous + EWMA * (ms - previous));
            if (running) loadedDuringUnit += ms;
        },
        estimateFinish(kind, units, urgency, deadline) {
            const at = now();
            const probe: Entry = { request: { kind, urgency, deadline, unitsLeft: units, run: async () => null }, order: order + 1, queuedAt: at, settle: () => undefined, fail: () => undefined };
            // What is left of the unit running, then every task picked before this one, all its units:
            // a task ahead submits its next unit as soon as one answers, and goes on being picked first.
            const current = running ? Math.max(0, unitMs(running.kind) - (at - running.started)) : 0;
            const ahead = queue.filter(entry => !entry.request.paused?.() && compare(entry, probe, at) < 0)
                .reduce((sum, entry) => sum + (entry.request.unitsLeft ?? 1) * unitMs(entry.request.kind), 0);
            return at + current + ahead + units * unitMs(kind) + (isLoaded(kind) ? 0 : loadMs(kind));
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
 * refresh (the shortest of the recent gaps). A hidden page has no frames to drop and is not
 * watched. Null off a renderer.
 */
export const watchFrames = (): FrameWatch | null => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return null;
    // The refresh is the shortest of the last REFRESH_GAPS gaps, not of the session: a window moved
    // from a 120 Hz display to a 60 Hz one would otherwise count every frame after as dropped.
    const REFRESH_GAPS = 120;
    const recent: number[] = [];
    let handle = 0;
    let last = 0;
    let worst = 0;
    let over = 0;
    let watching = false;
    const refresh = () => (recent.length ? Math.min(...recent) : Infinity);
    const step = (at: number) => {
        if (!watching) return;
        if (last) {
            const gap = at - last;
            recent.push(gap);
            if (recent.length > REFRESH_GAPS) recent.shift();
            worst = Math.max(worst, gap);
            if (gap > refresh() * 1.5) over += 1;
        }
        last = at;
        handle = window.requestAnimationFrame(step);
    };
    // A page hidden mid-unit has no frames; the gap across it is not a dropped frame.
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { last = 0; });
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
            const shortest = refresh();
            return Number.isFinite(shortest) && worst > 0 ? { worst, refresh: shortest, over } : null;
        },
    };
};

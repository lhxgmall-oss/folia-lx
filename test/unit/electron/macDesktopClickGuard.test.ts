import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/macDesktopClickGuard.test.ts
// The macOS Stage Manager click guard's process handling (issue #698): the region it is told, how
// it stops, and when an exit is retried. The Swift helper itself needs a real macOS session.

const require = createRequire(import.meta.url);
const { MAX_RESTARTS, formatRegion, createMacDesktopClickGuard } = require('../../../electron/wallpaper/macDesktopClickGuard.cjs');

const fakeProcess = () => {
    const proc = new EventEmitter() as EventEmitter & { stdin: any; stdout: EventEmitter & { setEncoding: () => void }; kill: () => void; written: string[] };
    proc.written = [];
    proc.stdin = { destroyed: false, write: (s: string) => proc.written.push(s), end: vi.fn(), on: vi.fn() };
    proc.stdout = Object.assign(new EventEmitter(), { setEncoding: () => {} });
    proc.kill = vi.fn();
    return proc;
};

const setup = () => {
    const procs: ReturnType<typeof fakeProcess>[] = [];
    const timers: Array<() => void> = [];
    const guard = createMacDesktopClickGuard({
        helperPath: '/helper',
        existsSync: () => true,
        spawn: () => { const p = fakeProcess(); procs.push(p); return p; },
        setTimer: (fn: () => void) => { timers.push(fn); return {}; },
        clearTimer: () => {},
        logWarn: () => {},
    });
    return { guard, procs, timers };
};

describe('formatRegion', () => {
    it('writes the frame, or none', () => {
        expect(formatRegion({ x: 0, y: -1080, width: 1920, height: 1080 })).toBe('region 0 -1080 1920 1080');
        expect(formatRegion(null)).toBe('region none');
        expect(formatRegion({ x: Number.NaN, y: 0, width: 1, height: 1 })).toBe('region none');
    });
});

describe('createMacDesktopClickGuard', () => {
    it('spawns once and keeps the helper on the wallpaper frame', () => {
        const { guard, procs } = setup();
        guard.start({ x: 0, y: 0, width: 100, height: 50 });
        guard.start({ x: 0, y: 0, width: 200, height: 50 });
        expect(procs).toHaveLength(1);
        expect(procs[0].written).toEqual(['region 0 0 100 50\n', 'region 0 0 200 50\n']);
    });

    it('stops by closing stdin, and does not come back', () => {
        const { guard, procs, timers } = setup();
        guard.start({ x: 0, y: 0, width: 100, height: 50 });
        guard.stop();
        expect(procs[0].stdin.end).toHaveBeenCalled();
        procs[0].emit('exit', 0);
        expect(timers).toHaveLength(0);
        expect(guard.isRunning()).toBe(false);
    });

    it('retries a crash a few times, then stays off', () => {
        const { guard, procs, timers } = setup();
        guard.start({ x: 0, y: 0, width: 100, height: 50 });
        for (let i = 0; i < MAX_RESTARTS; i++) {
            procs[procs.length - 1].emit('exit', 1);
            timers.shift()!();
        }
        expect(procs).toHaveLength(MAX_RESTARTS + 1);
        procs[procs.length - 1].emit('exit', 1);
        expect(timers).toHaveLength(0);
    });

    it('does not retry a helper without the grant', () => {
        const { guard, procs, timers } = setup();
        guard.start({ x: 0, y: 0, width: 100, height: 50 });
        procs[0].stdout.emit('data', 'untrusted\n');
        procs[0].emit('exit', 3);
        expect(timers).toHaveLength(0);
        expect(guard.lastExit()).toBe('untrusted');
    });

    it('does nothing without the helper binary', () => {
        const guard = createMacDesktopClickGuard({ helperPath: '/missing', existsSync: () => false, spawn: vi.fn() });
        expect(guard.start({ x: 0, y: 0, width: 1, height: 1 })).toBe(false);
        expect(guard.lastExit()).toBe('missing');
    });
});

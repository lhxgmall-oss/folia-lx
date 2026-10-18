import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/automix/stemExecutor.test.ts
// Where automix's stem windows are separated since the analysis service's phase 3: on the GPU by
// default, through the analysis scheduler on the shared segment grid (analysis/stemRange.ts); on the
// CPU (the analysis worker's MNN) without a GPU, after a GPU run that could not, or when the GPU would
// be late for a deadline - and then with the scheduler's thread level.

const { getCachedSongAudioBlob } = vi.hoisted(() => ({
    getCachedSongAudioBlob: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/audioCache', () => ({
    onAudioCached: () => () => { },
    getCachedAudioBlob: vi.fn(),
    hasCachedAudio: vi.fn().mockResolvedValue(false),
    saveAudioBlob: vi.fn(),
}));
vi.mock('@/services/onlineMusic/resourceCache', () => ({ getCachedSongAudioBlob }));

const gpu = vi.hoisted(() => ({ finish: 0, works: true, usable: true }));
const { runHtdemucsGpu } = vi.hoisted(() => ({ runHtdemucsGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({
    HTDEMUCS_GPU_SEGMENT: 256,
    runHtdemucsGpu,
    estimateGpuFinish: () => gpu.finish,
    gpuStemsUsable: () => gpu.usable,
}));

import { refreshModelAvailability } from '@/services/analysis/modelAvailability';
import { cpuThreads } from '@/services/analysis/scheduler';
import { clearStemDeadlines, ensureStems, getStemsByKey, resetStemExecutorForTests, setWantedStems, stemWindowKey } from '@/services/automix/stems';
import { getPlaybackAnalysisKey } from '@/services/playbackRecovery/representationRegistry';

const SAMPLES = 1024;
const signal = (phase: number) => Float32Array.from({ length: SAMPLES }, (_, i) => Math.sin(i * 0.37 + phase) * 0.5);
const decoded = {
    length: SAMPLES,
    numberOfChannels: 2,
    getChannelData: (channel: number) => signal(channel),
};
const rows = () => ({ left: new Float32Array(SAMPLES), right: new Float32Array(SAMPLES) });

let songs = 0;
const nextSong = (): SongResult => {
    songs += 1;
    return { id: `s${songs}`, name: `track ${songs}`, sourceRef: { kind: 'online', providerId: 'kugou', mediaId: `s${songs}` } } as unknown as SongResult;
};

const setUp = ({ withGpu = true, withCpu = true } = {}) => {
    const separateStems = vi.fn(async () => ({ drums: rows(), bass: rows(), vocals: rows() }));
    (globalThis as { window?: object }).window = {
        electron: {
            ...(withCpu ? { separateStems } : {}),
            ...(withGpu ? { getHtdemucsGpuWeights: vi.fn() } : {}),
            getAutomixModelsPresent: vi.fn().mockResolvedValue({ beat_this: true, htdemucs: withCpu, htdemucs_gpu: withGpu }),
        },
        OfflineAudioContext: class {
            decodeAudioData() { return Promise.resolve(decoded); }
        },
    };
    vi.stubGlobal('navigator', withGpu ? { gpu: {}, hardwareConcurrency: 8 } : { hardwareConcurrency: 8 });
    return { separateStems, ready: refreshModelAvailability() };
};

const separate = (song: SongResult, deadline?: number) => {
    setWantedStems([stemWindowKey(song, 'tail')]);
    return ensureStems({ song, role: 'tail', readBytes: () => Promise.resolve(new ArrayBuffer(8)), deadline });
};

describe('where a stem window is separated', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array) => {
            if (!gpu.works) return null;
            const stems = [0.5, 0.2, 0.1, 0.2].map(gain => ({ left: left.map(v => v * gain), right: right.map(v => v * gain) }));
            return { left: stems[0].left, right: stems[0].right, stems };
        });
        gpu.finish = 0;
        gpu.works = true;
        gpu.usable = true;
        resetStemExecutorForTests();
    });

    it('takes the GPU by default, on the segment grid, and never asks the CPU', async () => {
        const { separateStems, ready } = setUp();
        await ready;
        const song = nextSong();
        await separate(song);
        // 1024 samples on 256-sample segments a step of 192 apart: six segments.
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(6);
        expect(separateStems).not.toHaveBeenCalled();
        const stems = getStemsByKey(getPlaybackAnalysisKey(song), 'tail');
        expect(stems).not.toBeNull();
        expect(stems!.duration).toBeCloseTo(SAMPLES / 44100);
    });

    it('falls back to the CPU at the quiet level when the GPU run cannot', async () => {
        const { separateStems, ready } = setUp();
        await ready;
        gpu.works = false;
        await separate(nextSong());
        expect(separateStems).toHaveBeenCalledTimes(1);
        // A GPU machine's fallback: not kept loaded (phase 4).
        expect(separateStems.mock.calls[0]).toMatchObject([{ threads: cpuThreads(8, 'quiet', 'htdemucs'), resident: false }]);
    });

    it('runs on the CPU without a GPU', async () => {
        const { separateStems, ready } = setUp({ withGpu: false });
        await ready;
        await separate(nextSong());
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
        expect(separateStems).toHaveBeenCalledTimes(1);
        // The CPU is this machine's separator: kept loaded while automix is on, as before.
        expect(separateStems.mock.calls[0]).toMatchObject([{ resident: true }]);
    });

    it('takes the CPU, hurried, when the GPU would be late for the deadline and the quiet CPU too', async () => {
        const { separateStems, ready } = setUp();
        await ready;
        // A window of 1024 samples is ~5.6 ms of CPU at the quiet level (two threads of eight cores),
        // ~2.8 ms hurried (four), each after the 1.5 s build (none yet): due 5 s, 1.5 s and 4 ms out,
        // only the hurried CPU is on time by the 5 s margin; the GPU is an hour late.
        // A still clock, so the few ms the decode takes do not eat the ms between the two levels.
        const now = 1_000_000;
        const clock = vi.spyOn(performance, 'now').mockReturnValue(now);
        gpu.finish = now + 3_600_000;
        await separate(nextSong(), now + 5000 + 1500 + 4);
        clock.mockRestore();
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
        expect(separateStems).toHaveBeenCalledTimes(1);
        expect(separateStems.mock.calls[0]).toMatchObject([{ threads: cpuThreads(8, 'hurry', 'htdemucs') }]);
    });

    it('stays on the GPU without a CPU model, however late', async () => {
        const { separateStems, ready } = setUp({ withCpu: false });
        await ready;
        gpu.finish = performance.now() + 3_600_000;
        await separate(nextSong(), performance.now() + 1000);
        expect(runHtdemucsGpu).toHaveBeenCalled();
        expect(separateStems).not.toHaveBeenCalled();
    });
});


describe('where a stem window is separated, from review', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array) => {
            const stems = [0.5, 0.2, 0.1, 0.2].map(gain => ({ left: left.map(v => v * gain), right: right.map(v => v * gain) }));
            return { left: stems[0].left, right: stems[0].right, stems };
        });
        gpu.finish = 0;
        gpu.works = true;
        gpu.usable = true;
        resetStemExecutorForTests();
    });

    it('does not send windows to a GPU that turned out unusable, and keeps the CPU model loaded there', async () => {
        const { separateStems, ready } = setUp();
        await ready;
        gpu.usable = false;
        await separate(nextSong());
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
        expect(separateStems.mock.calls[0]).toMatchObject([{ resident: true }]);
    });

    it('gives a window under way the deadline a later call brings, at its next GPU segment', async () => {
        const { ready } = setUp({ withCpu: false });
        await ready;
        const song = nextSong();
        const seen: Array<number | undefined> = [];
        let first = true;
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array, options: { deadline?: number }) => {
            seen.push(options.deadline);
            if (first) {
                first = false;
                // The duration arrives while the first segment runs: the effect asks again, with it.
                await ensureStems({ song, role: 'tail', readBytes: () => Promise.resolve(new ArrayBuffer(8)), deadline: 123_456 });
            }
            const stems = [0, 1, 2, 3].map(() => ({ left: left.slice(), right: right.slice() }));
            return { left: stems[0].left, right: stems[0].right, stems };
        });
        await separate(song);
        expect(seen[0]).toBeUndefined();
        expect(seen.slice(1).every(deadline => deadline === 123_456)).toBe(true);
    });

    it('drops the deadlines of windows under way while paused', async () => {
        const { ready } = setUp({ withCpu: false });
        await ready;
        const seen: Array<number | undefined> = [];
        let first = true;
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array, options: { deadline?: number }) => {
            seen.push(options.deadline);
            if (first) {
                first = false;
                clearStemDeadlines();
            }
            const stems = [0, 1, 2, 3].map(() => ({ left: left.slice(), right: right.slice() }));
            return { left: stems[0].left, right: stems[0].right, stems };
        });
        await separate(nextSong(), 999_999);
        expect(seen[0]).toBe(999_999);
        expect(seen.slice(1).every(deadline => deadline === undefined)).toBe(true);
    });
});

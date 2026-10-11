// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { motionValue } from 'framer-motion';
import { usePlaybackVisualizerBridge } from '../../../src/hooks/usePlaybackVisualizerBridge';
import { PlayerState } from '../../../src/types';
import { audioBands, currentTime, lyricCurrentTime } from '../../../src/stores/motionSignals';

// test/unit/hooks/playbackVisualizerBridge.test.ts

const mocks = vi.hoisted(() => ({
    state: { activePlaybackContext: 'normal', playerState: 'playing', duration: 10, lyrics: null as any },
    setCurrentLineIndex: vi.fn(), setPlayerState: vi.fn(),
}));
vi.mock('../../../src/stores/usePlaybackStore', () => ({
    usePlaybackStore: (select: (state: typeof mocks.state) => unknown) => select(mocks.state),
    selectDisplayLyrics: (state: typeof mocks.state) => state.lyrics,
    setCurrentLineIndex: mocks.setCurrentLineIndex, setPlayerState: mocks.setPlayerState,
}));
vi.mock('../../../src/stores/motionSignals', async () => {
    const { motionValue } = await import('framer-motion');
    return {
        audioBands: Object.fromEntries(['bass', 'lowMid', 'mid', 'vocal', 'treble'].map(key => [key, motionValue(0)])),
        audioPower: motionValue(0), currentTime: motionValue(0), lyricCurrentTime: motionValue(0),
    };
});

let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let nextHandle: number;
let options: Parameters<typeof usePlaybackVisualizerBridge>[0];
const tick = (time: number) => act(() => {
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(time);
});
function Probe() { usePlaybackVisualizerBridge(options); return null; }
const render = () => act(() => root.render(createElement(Probe)));

beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    frames = new Map(); nextHandle = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        frames.set(++nextHandle, callback); return nextHandle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => frames.delete(handle));
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    mocks.state = { activePlaybackContext: 'normal', playerState: PlayerState.PLAYING, duration: 10, lyrics: {
        lines: [{ startTime: 0, endTime: 2 }, { startTime: 3, endTime: 8 }],
    } };
    audioBands.spectrum = motionValue(new Uint8Array(0));
    options = {
        audioRef: { current: { currentTime: 1, paused: false, ended: false } as HTMLAudioElement },
        analyserRef: { current: { frequencyBinCount: 1024, getByteFrequencyData: (data: Uint8Array) => data.fill(128) } as unknown as AnalyserNode },
        animationFrameRef: { current: 0 }, effectiveLoopMode: 'off',
        isNowPlayingStageActive: false, isPlayerCapStageActive: false,
        stageActiveEntryKind: null, stageLyricsSession: null,
        stageLyricsClockRef: { current: { startTimeSec: 0, endTimeSec: 10, baseTimeSec: 0, startedAtMs: null } },
        getSyntheticStageLyricsTime: () => 0, syncStageLyricsClock: vi.fn(),
        getNowPlayingDisplayTime: () => 0, getPlayerCapDisplayTime: () => 0,
        syncNowPlayingClock: vi.fn(), lyricTimelineOffsetMs: 500, isTransitionAudible: () => false,
    };
});
afterEach(() => {
    act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
});

describe('playback visualizer frame loop', () => {
    it('reuses two FFT buffers while publishing every sampled frame', () => {
        const seen: Uint8Array[] = [];
        const samples: number[] = [];
        let sample = 0;
        options.analyserRef.current!.getByteFrequencyData = data => {
            const currentFrame = audioBands.spectrum.get();
            data.fill(++sample);
            if (sample > 1) expect(currentFrame[0]).toBe(sample - 1);
        };
        const stop = audioBands.spectrum.on('change', value => {
            seen.push(value); samples.push(value[0]);
        });
        render(); for (let frame = 0; frame < 20; frame += 1) tick(frame * 16);
        expect(seen).toHaveLength(20);
        expect(new Set(seen).size).toBe(2);
        expect(seen[0]).not.toBe(seen[1]); expect(seen[0]).toBe(seen[2]);
        expect(samples).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
        expect(currentTime.get()).toBe(1); expect(lyricCurrentTime.get()).toBe(0.5);
        expect(mocks.setCurrentLineIndex.mock.calls).toEqual([[0]]);
        stop();
    });

    it('reallocates for an FFT-size change and clears idle spectrum only once', () => {
        render(); tick(0);
        (options.analyserRef.current as any).frequencyBinCount = 2048;
        tick(16); expect(audioBands.spectrum.get().length).toBe(2048);
        const seen: Uint8Array[] = [];
        const stop = audioBands.spectrum.on('change', value => seen.push(value));
        (options.audioRef.current as any).paused = true;
        for (let frame = 0; frame < 10; frame += 1) tick(frame * 16);
        expect(seen).toHaveLength(1); expect(seen[0].length).toBe(0);
        stop();
    });

    it('follows the displayed outgoing deck, supports seeks and replaces lyric snapshots', () => {
        options.getDisplayElement = () => ({ currentTime: 4, paused: false, ended: false } as HTMLAudioElement);
        render(); tick(0); expect(currentTime.get()).toBe(4); expect(mocks.setCurrentLineIndex).toHaveBeenLastCalledWith(1);
        options.getDisplayElement = () => ({ currentTime: 1, paused: false, ended: false } as HTMLAudioElement);
        render(); tick(16); expect(mocks.setCurrentLineIndex).toHaveBeenLastCalledWith(0);
        mocks.state.lyrics = { lines: [{ startTime: 9, endTime: 10 }] };
        render(); tick(32); expect(mocks.setCurrentLineIndex).toHaveBeenLastCalledWith(-1);
        expect(frames.size).toBe(1);
    });

    it('keeps external clock looping and cancels the frame on unmount', () => {
        (options.audioRef.current as any).paused = true;
        options.isNowPlayingStageActive = true; options.effectiveLoopMode = 'one';
        options.getNowPlayingDisplayTime = () => 10;
        render(); tick(0);
        expect(options.syncNowPlayingClock).toHaveBeenCalledWith(0, 10, false);
        expect(currentTime.get()).toBe(0);
        act(() => root.unmount()); expect(frames.size).toBe(0);
        root = createRoot(host);
    });

    it('keeps sampling an audible transition when the displayed deck is paused', () => {
        (options.audioRef.current as any).paused = true;
        options.isTransitionAudible = () => true;
        render(); tick(0); tick(16);
        expect(audioBands.spectrum.get().length).toBe(1024);
        expect(audioBands.spectrum.get()[0]).toBe(128);
    });

    it('uses indexed lyrics with PlayerCap and the synthetic Stage loop', () => {
        (options.audioRef.current as any).paused = true;
        options.isPlayerCapStageActive = true;
        options.getPlayerCapDisplayTime = () => 4;
        render(); tick(0);
        expect(currentTime.get()).toBe(4); expect(lyricCurrentTime.get()).toBe(3.5);
        expect(mocks.setCurrentLineIndex).toHaveBeenLastCalledWith(1);

        options.isPlayerCapStageActive = false;
        mocks.state.activePlaybackContext = 'stage';
        options.stageActiveEntryKind = 'lyrics'; options.stageLyricsSession = {};
        options.effectiveLoopMode = 'one'; options.getSyntheticStageLyricsTime = () => 10;
        render(); tick(16);
        expect(options.syncStageLyricsClock).toHaveBeenCalledWith(0, 10, PlayerState.PLAYING, 0);
        expect(currentTime.get()).toBe(0);
        expect(mocks.setCurrentLineIndex).toHaveBeenLastCalledWith(0);
    });
});

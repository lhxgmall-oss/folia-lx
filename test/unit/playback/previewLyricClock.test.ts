import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricData } from '@/types';
import { PlayerState } from '@/types';
import { currentTime, handoffLyricCurrentTime, lyricCurrentTime } from '@/stores/motionSignals';
import { usePlaybackVisualizerBridge } from '@/components/app/playback/bridges/usePlaybackVisualizerBridge';
import { buildObsBrowserSourceClock, resolveObsBrowserSourceClockTime } from '@/utils/obsBrowserSource';

// Exercises the real frame and handover paths without a renderer, using the same preview lookup
// contract as the OBS publisher. Media progress and saved manual offsets remain clip-relative.
const env = vi.hoisted(() => ({
    effects: [] as Array<() => unknown>,
    cleanup: [] as Array<() => void>,
    frame: null as FrameRequestCallback | null,
    subscriber: null as ((state: any, previous: any) => void) | null,
    state: {} as any,
    starts: new Map<string, number>(),
    version: 0,
    lookup: vi.fn((url: string): number => 0),
}));
vi.mock('react', async importOriginal => ({
    ...(await importOriginal<typeof import('react')>()),
    useCallback: (fn: unknown) => fn,
    useRef: (value: unknown) => ({ current: value }),
    useEffect: (fn: () => unknown) => { env.effects.push(fn); },
}));
vi.mock('@/stores/usePlaybackStore', () => ({
    usePlaybackStore: Object.assign(
        (selector: (state: any) => unknown) => selector(env.state),
        { subscribe: (fn: typeof env.subscriber) => { env.subscriber = fn; return () => {}; } },
    ),
    selectDisplayLyrics: (state: any) => state.transitionDisplay?.lyrics ?? state.lyrics,
    setCurrentLineIndex: vi.fn(),
    setHandoffLineIndex: vi.fn(),
    setPlayerState: vi.fn(),
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: {
    previewClipStartMsOfAudioSource: env.lookup,
    audioSourceMetadataVersion: () => env.version,
} }));
vi.mock('@/hooks/useBeatFxTrack', () => ({ useBeatFxTrack: () => false }));
vi.mock('@/services/beatFx/beatFxLive', () => ({ tickBeatFx: vi.fn() }));
vi.mock('@/services/automix/transitionCue', () => ({ getTransitionHandoffProgress: () => 0.5 }));

const lyrics: LyricData = { lines: [{ fullText: 'clip', startTime: 30, endTime: 90, words: [] }] };
const audio = (url: string, time = 2) => ({ currentSrc: url, currentTime: time, paused: false, ended: false }) as HTMLAudioElement;
const mount = (incoming: HTMLAudioElement, displayed: HTMLAudioElement | null = null) => {
    usePlaybackVisualizerBridge({
        audioRef: { current: incoming }, analyserRef: { current: null }, animationFrameRef: { current: 0 },
        effectiveLoopMode: 'off', isNowPlayingStageActive: false, isPlayerCapStageActive: false,
        stageActiveEntryKind: null, stageLyricsSession: null,
        stageLyricsClockRef: { current: { startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null } },
        getSyntheticStageLyricsTime: () => 0, syncStageLyricsClock: vi.fn(),
        getNowPlayingDisplayTime: () => 0, getPlayerCapDisplayTime: () => 0, syncNowPlayingClock: vi.fn(),
        lyricTimelineOffsetMs: 500, incomingLyricTimelineOffsetMs: 1000,
        isTransitionAudible: () => displayed !== null, getDisplayElement: () => displayed,
    });
    for (const effect of env.effects.splice(0)) {
        const cleanup = effect();
        if (typeof cleanup === 'function') env.cleanup.push(cleanup as () => void);
    }
};
const frame = () => { expect(env.frame).not.toBeNull(); env.frame!(0); };
const obs = (url: string, manualOffsetMs = 500) => buildObsBrowserSourceClock({
    currentTime: currentTime.get(), duration: 30, playerState: PlayerState.PLAYING,
    sentAtMs: 1000, playbackRate: 1, lyricOffsetMs: manualOffsetMs,
}, env.starts.get(url) ?? 0);

beforeEach(() => {
    env.starts.clear(); env.version = 0;
    env.lookup.mockReset().mockImplementation(url => env.starts.get(url) ?? 0);
    env.effects = []; env.cleanup = []; env.subscriber = null;
    env.state = { activePlaybackContext: 'main', playerState: PlayerState.PLAYING, duration: 30, lyrics, transitionDisplay: null };
    currentTime.set(0); lyricCurrentTime.set(0); handoffLyricCurrentTime.set(0);
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { env.frame = fn; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { env.cleanup.forEach(fn => fn()); vi.unstubAllGlobals(); });

describe('preview lyric clock consumers', () => {
    it('aligns main and OBS at 31.5 s without changing the 2 s media position or 500 ms manual offset', () => {
        env.starts.set('https://audio.test/preview', 30000);
        mount(audio('https://audio.test/preview'));
        frame(); frame();
        expect(currentTime.get()).toBe(2);
        expect(lyricCurrentTime.get()).toBe(31.5);
        expect(env.lookup).toHaveBeenCalledTimes(1);
        const clock = obs('https://audio.test/preview');
        expect(clock.currentTime).toBe(2);
        expect(clock.duration).toBe(30);
        expect(resolveObsBrowserSourceClockTime(clock, 1000)).toBe(lyricCurrentTime.get());
        expect(resolveObsBrowserSourceClockTime(clock, 2000)).toBe(32.5);
        expect(resolveObsBrowserSourceClockTime(clock, 100000)).toBe(59.5);
        expect(resolveObsBrowserSourceClockTime({ ...clock, playerState: PlayerState.PAUSED }, 100000)).toBe(31.5);
    });

    it.each(['file:///music/song.flac', 'blob:http://localhost/cached-song', 'https://navidrome.test/stream', ''])('leaves a non-preview source unchanged: %s', url => {
        mount(audio(url)); frame();
        expect(currentTime.get()).toBe(2);
        expect(lyricCurrentTime.get()).toBe(1.5);
        expect(resolveObsBrowserSourceClockTime(obs(url), 1000)).toBe(1.5);
    });

    it.each(['replaced by full song', 'evicted'])('invalidates a cached clip start when its registry entry is %s', () => {
        const url = 'https://audio.test/reused-url';
        env.starts.set(url, 30000);
        mount(audio(url)); frame();
        expect(lyricCurrentTime.get()).toBe(31.5);
        env.starts.delete(url); env.version++;
        frame();
        expect(currentTime.get()).toBe(2);
        expect(lyricCurrentTime.get()).toBe(1.5);
        expect(resolveObsBrowserSourceClockTime(obs(url), 1000)).toBe(1.5);
        expect(env.lookup).toHaveBeenCalledTimes(2);
        // A later re-registration also reaches the existing deck without a URL change.
        env.starts.set(url, 60000); env.version++;
        frame();
        expect(lyricCurrentTime.get()).toBe(61.5);
        expect(resolveObsBrowserSourceClockTime(obs(url), 1000)).toBe(61.5);
    });

    it('drops the previous preview offset when a deck switches to a cached or local file', () => {
        const deck = audio('https://audio.test/old-preview');
        env.starts.set(deck.currentSrc, 30000);
        mount(deck); frame();
        expect(lyricCurrentTime.get()).toBe(31.5);
        Object.assign(deck, { currentSrc: 'blob:http://localhost/full-song', currentTime: 8 });
        frame();
        expect(lyricCurrentTime.get()).toBe(7.5);
        expect(resolveObsBrowserSourceClockTime(obs(deck.currentSrc), 1000)).toBe(7.5);
    });

    it('looks up the restored deck by its current URL, not a previous track or saved manual offset', () => {
        env.starts.set('https://audio.test/restored-preview', 60000);
        mount(audio('https://audio.test/restored-preview', 7)); frame();
        expect(lyricCurrentTime.get()).toBe(66.5);
        expect(resolveObsBrowserSourceClockTime(obs('https://audio.test/restored-preview'), 1000)).toBe(66.5);
    });

    it('keeps outgoing and incoming clip clocks separate, then continues the incoming clock at handover', () => {
        const outgoing = audio('https://audio.test/outgoing', 20);
        const incoming = audio('https://audio.test/incoming', 3);
        env.starts.set(outgoing.currentSrc, 30000); env.starts.set(incoming.currentSrc, 60000);
        env.state.transitionDisplay = { lyrics };
        mount(incoming, outgoing); frame();
        expect(currentTime.get()).toBe(20);
        expect(lyricCurrentTime.get()).toBe(49.5);
        expect(handoffLyricCurrentTime.get()).toBe(62);
        expect(resolveObsBrowserSourceClockTime(obs(outgoing.currentSrc), 1000)).toBe(49.5);
        const previous = env.state;
        env.state = { ...env.state, transitionDisplay: null, transitionEnd: 'handedOver' };
        env.subscriber!(env.state, previous);
        expect(currentTime.get()).toBe(3);
        expect(lyricCurrentTime.get()).toBe(62);
        expect(resolveObsBrowserSourceClockTime(obs(incoming.currentSrc, 1000), 1000)).toBe(62);
    });
});

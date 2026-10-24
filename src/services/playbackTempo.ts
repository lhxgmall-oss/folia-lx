// src/services/playbackTempo.ts
// The listener's playback speed and pitch (变速 / 升降调), on desktop and Android alike.
//
// Three settings, kept in localStorage and outside the equaliser presets:
//   - speed: 0.5x to 2x, the media elements' own rate;
//   - semitones: -12 to +12, a pitch shift through an AudioWorklet (pitchShiftWorklet.ts);
//   - keepPitch: whether a speed change keeps the pitch (变速不变调) or moves it like a record would.
//
// With no pitch shift the elements do it all: playbackRate plus preservesPitch = keepPitch, which is
// the browser's own time stretcher and the best quality there is. Only a pitch shift needs the
// worklet; the elements then always keep pitch and the worklet moves it by 2^(semitones/12), times
// the speed when the speed should move the pitch too.

export type PlaybackTempo = { speed: number; semitones: number; keepPitch: boolean };

export const PLAYBACK_SPEED_MIN = 0.5;
export const PLAYBACK_SPEED_MAX = 2;
export const PLAYBACK_SEMITONES_MIN = -12;
export const PLAYBACK_SEMITONES_MAX = 12;
export const DEFAULT_PLAYBACK_TEMPO: PlaybackTempo = { speed: 1, semitones: 0, keepPitch: true };

const STORAGE_KEY = 'folia:playbackTempo';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const normalizePlaybackTempo = (value: unknown): PlaybackTempo => {
    const candidate = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const speed = Number(candidate.speed);
    const semitones = Number(candidate.semitones);
    return {
        speed: Number.isFinite(speed) ? Math.round(clamp(speed, PLAYBACK_SPEED_MIN, PLAYBACK_SPEED_MAX) * 100) / 100 : 1,
        semitones: Number.isFinite(semitones) ? Math.round(clamp(semitones, PLAYBACK_SEMITONES_MIN, PLAYBACK_SEMITONES_MAX) * 2) / 2 : 0,
        keepPitch: candidate.keepPitch !== false,
    };
};

const load = (): PlaybackTempo => {
    try {
        return normalizePlaybackTempo(JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null'));
    } catch {
        return { ...DEFAULT_PLAYBACK_TEMPO };
    }
};

let current: PlaybackTempo = load();
const listeners = new Set<(tempo: PlaybackTempo) => void>();

export const getPlaybackTempo = (): PlaybackTempo => current;

/** The pitch ratio the worklet has to apply on top of the elements; 1 means no worklet at all. */
export const getPitchShiftRatio = (tempo: PlaybackTempo = current): number => {
    if (tempo.semitones === 0) return 1;
    return 2 ** (tempo.semitones / 12) * (tempo.keepPitch ? 1 : tempo.speed);
};

/** Whether the element's own stretcher should keep the pitch: always while the worklet moves it. */
export const elementPreservesPitch = (tempo: PlaybackTempo = current): boolean => tempo.semitones !== 0 || tempo.keepPitch;

/** The automix tempo bend each deck is in, if any (set by tempoBend.ts). */
const bends = new WeakMap<HTMLMediaElement, number>();
export const setElementTempoBend = (element: HTMLMediaElement, bend: number | null) => {
    if (bend && bend !== 1) bends.set(element, bend);
    else bends.delete(element);
};

/** Puts the listener's speed on one element. An automix tempo bend multiplies on top (tempoBend.ts). */
export const applyPlaybackTempoToElement = (element: HTMLMediaElement, bend = bends.get(element) ?? 1) => {
    element.preservesPitch = bend !== 1 ? true : elementPreservesPitch();
    // A load resets playbackRate to defaultPlaybackRate, so the speed survives every track change.
    element.defaultPlaybackRate = current.speed;
    const rate = current.speed * bend;
    if (Math.abs(element.playbackRate - rate) > 0.0005) element.playbackRate = rate;
};

const applyToDocument = () => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('audio').forEach((element) => {
        // A deck in an automix tempo bend keeps its bend; tempoBend reapplies the speed when it settles.
        applyPlaybackTempoToElement(element);
    });
};

export const setPlaybackTempo = (next: Partial<PlaybackTempo>) => {
    current = normalizePlaybackTempo({ ...current, ...next });
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
        // Private mode or full storage: the setting still holds for this session.
    }
    applyToDocument();
    listeners.forEach(listener => listener(current));
};

export const subscribePlaybackTempo = (listener: (tempo: PlaybackTempo) => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

// Media events do not bubble, so a capture listener on the document sees every deck's load and play
// and puts the speed back on it (a new <audio> or a recycled one starts at rate 1).
if (typeof document !== 'undefined') {
    const reapply = (event: Event) => {
        const element = event.target;
        if (!(element instanceof HTMLMediaElement)) return;
        applyPlaybackTempoToElement(element);
    };
    document.addEventListener('loadstart', reapply, true);
    document.addEventListener('play', reapply, true);
    queueMicrotask(applyToDocument);
}

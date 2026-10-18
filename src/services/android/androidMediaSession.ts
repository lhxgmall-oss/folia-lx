import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

// src/services/android/androidMediaSession.ts
// Android WebView has navigator.mediaSession but shows nothing for it: no notification, no lock
// screen or quick-settings player, no headset buttons. On the Android app this replaces
// navigator.mediaSession with a stand-in that forwards metadata, state, position and the action
// handlers the page registers (hooks/useMediaSessionBridge.ts) to the native LxMedia plugin
// (android/.../LxMediaController.java), which runs a real MediaSession with a media notification and
// a foreground service, so playback also survives in the background. Buttons pressed there come back
// as 'action' events and call the page's handlers, exactly as Chromium would.

type NativeState = 'playing' | 'paused' | 'none';

interface LxMediaUpdate {
    title: string;
    artist: string;
    album: string;
    artwork: string;
    state: NativeState;
    position: number;
    duration: number;
    rate: number;
    actions: string[];
}

export interface LxMediaNativeStatus {
    sdk: number;
    permission: boolean;
    notificationsEnabled: boolean;
    channelImportance: number;
    updates: number;
    lastTitle: string;
    lastState: string;
    serviceRunning: boolean;
    sessionActive: boolean;
    lastError: string;
    artworkLoaded: boolean;
}

interface LxMediaPlugin {
    update(options: LxMediaUpdate): Promise<void>;
    status(): Promise<LxMediaNativeStatus>;
    requestPermission(): Promise<{ granted: boolean }>;
    openSettings(): Promise<void>;
    testNotification(): Promise<void>;
    addListener(event: 'action', listener: (data: { action: string; seekTime?: number }) => void): Promise<PluginListenerHandle>;
}

const LxMedia = registerPlugin<LxMediaPlugin>('LxMedia');

/** What the page side has done so far, for the 播放通知诊断 row in settings. */
export const lxMediaDiagnostics = {
    installed: false,
    metadataSets: 0,
    pushes: 0,
    pushErrors: 0,
    lastError: '',
    lastTitle: '',
    lastState: '',
    artwork: '',
};

export const readLxMediaNativeStatus = () => LxMedia.status();
export const requestLxMediaPermission = () => LxMedia.requestPermission();
export const openLxMediaSettings = () => LxMedia.openSettings();
export const testLxMediaNotification = () => LxMedia.testNotification();

const playingAudio = (): HTMLAudioElement | null =>
    [...document.querySelectorAll('audio')].find(el => !el.paused && !el.ended) ?? null;

const anyAudioWithSource = (): HTMLAudioElement | null =>
    playingAudio() ?? [...document.querySelectorAll('audio')].find(el => !!el.currentSrc) ?? null;

type Handler = ((details: { action: string; seekTime?: number }) => void) | null;

const artworkSources = (metadata: MediaMetadata | null): string[] =>
    [...(metadata?.artwork ?? [])].map(item => item?.src ?? '').filter(Boolean).reverse();

// Covers the native side can fetch itself are sent as URLs; the rest (blob: from Folia's cover
// cache, app-local files) are drawn here, shrunk to 512 px and sent as a data: URL.
const convertedArtwork = new Map<string, string>();
const converting = new Set<string>();

const toDataUrl = async (src: string): Promise<string> => {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`artwork ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.85);
};

const resolveArtwork = (metadata: MediaMetadata | null, onReady: () => void): string => {
    const sources = artworkSources(metadata);
    const http = sources.find(src => /^https?:\/\//i.test(src)) ?? '';
    const other = sources[0];
    if (!other) return '';
    if (other.startsWith('data:') && other.length < 400_000) return other;
    // Drawn here first (the page can already read it, with the WebView's cover proxy); the native
    // side fetching the plain URL is the fallback.
    const done = convertedArtwork.get(other);
    if (done !== undefined) return done || http;
    if (converting.has(other)) return http;
    {
        converting.add(other);
        void toDataUrl(other)
            .then(data => { convertedArtwork.set(other, data); })
            .catch(error => { convertedArtwork.set(other, ''); lxMediaDiagnostics.lastError = `封面转换失败：${String(error?.message ?? error)}`; console.warn('[LxMedia] artwork failed', error); })
            .finally(() => { converting.delete(other); if (convertedArtwork.size > 20) convertedArtwork.delete(convertedArtwork.keys().next().value as string); onReady(); });
    }
    return http;
};

export const installAndroidMediaSession = (): void => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    const handlers = new Map<string, Handler>();
    let metadata: MediaMetadata | null = null;
    let playbackState: MediaSessionPlaybackState = 'none';
    let position = 0;
    let duration = 0;
    let rate = 1;
    let positionAt = Date.now();
    let scheduled = false;
    let everPlayed = false;

    const currentPosition = () => {
        if (playbackState !== 'playing') return position;
        const elapsed = ((Date.now() - positionAt) / 1000) * rate;
        const next = position + elapsed;
        return duration > 0 ? Math.min(next, duration) : next;
    };

    const push = () => {
        scheduled = false;
        const actions = [...handlers.entries()].filter(([, h]) => !!h).map(([name]) => name);
        // The element is the truth for playing / paused: the page's own state can lag or say 'none'
        // (stage mode), and then the system player would never appear.
        const live = playingAudio();
        if (live) everPlayed = true;
        let state: NativeState;
        if (live) state = 'playing';
        else if (metadata) state = playbackState === 'playing' ? 'playing' : 'paused';
        else if (everPlayed && anyAudioWithSource()) state = 'paused';
        else state = 'none';
        if (live && Number.isFinite(live.duration) && live.duration > 0) {
            duration = live.duration;
            position = live.currentTime;
            positionAt = Date.now();
            rate = live.playbackRate > 0 ? live.playbackRate : 1;
            if (playbackState !== 'playing') playbackState = 'playing';
        }
        const title = metadata?.title || (state !== 'none' ? 'Folia LX' : '');
        lxMediaDiagnostics.pushes += 1;
        lxMediaDiagnostics.lastTitle = title;
        lxMediaDiagnostics.lastState = state;
        const art = resolveArtwork(metadata, schedule);
        const srcs = artworkSources(metadata);
        lxMediaDiagnostics.artwork = `页面封面 ${srcs.length} 个（${srcs[0]?.slice(0, 40) ?? '无'}），发送 ${art ? art.slice(0, 16) : '无'}`;
        LxMedia.update({
            title,
            artist: metadata?.artist ?? '',
            album: metadata?.album ?? '',
            artwork: art,
            state: title ? state : 'none',
            position: currentPosition(),
            duration: Number.isFinite(duration) ? duration : 0,
            rate,
            actions,
        }).catch(error => {
            lxMediaDiagnostics.pushErrors += 1;
            lxMediaDiagnostics.lastError = String(error?.message ?? error);
            console.warn('[LxMedia] update failed', error);
        });
    };

    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(push);
    };

    const session = {
        get metadata() { return metadata; },
        set metadata(value: MediaMetadata | null) { metadata = value; lxMediaDiagnostics.metadataSets += 1; schedule(); },
        get playbackState() { return playbackState; },
        set playbackState(value: MediaSessionPlaybackState) {
            if (value === playbackState) return;
            position = currentPosition();
            positionAt = Date.now();
            playbackState = value;
            schedule();
        },
        setActionHandler(action: string, handler: Handler) {
            handlers.set(action, handler);
            schedule();
        },
        setPositionState(state?: MediaPositionState) {
            if (!state) {
                position = 0;
                duration = 0;
            } else {
                duration = Number(state.duration) || 0;
                position = Number(state.position) || 0;
                rate = Number(state.playbackRate) > 0 ? Number(state.playbackRate) : 1;
            }
            positionAt = Date.now();
            schedule();
        },
        setMicrophoneActive() {},
        setCameraActive() {},
    };

    try {
        Object.defineProperty(navigator, 'mediaSession', { configurable: true, get: () => session });
    } catch (error) {
        console.warn('[LxMedia] could not replace navigator.mediaSession', error);
        lxMediaDiagnostics.lastError = `replace failed: ${String(error)}`;
        return;
    }
    lxMediaDiagnostics.installed = navigator.mediaSession === (session as unknown as MediaSession);

    // Follow the audio elements directly too, so the system player tracks play / pause even when
    // the page's media-session code publishes nothing.
    for (const type of ['playing', 'pause', 'ended', 'durationchange', 'emptied']) {
        document.addEventListener(type, event => {
            const target = event.target as HTMLElement | null;
            if (!target || target.tagName !== 'AUDIO') return;
            if (type === 'pause' || type === 'ended') {
                if (!playingAudio() && playbackState === 'playing') {
                    position = currentPosition();
                    positionAt = Date.now();
                    playbackState = 'paused';
                }
            }
            schedule();
        }, true);
    }

    void LxMedia.addListener('action', ({ action, seekTime }) => {
        const handler = handlers.get(action);
        if (action === 'seekto' && typeof seekTime === 'number') {
            position = seekTime;
            positionAt = Date.now();
        }
        if (handler) {
            handler({ action, seekTime });
            return;
        }
        // No page handler for a native-only action: act on the playing element directly.
        if (action === 'seekto' && typeof seekTime === 'number') {
            const audio = [...document.querySelectorAll('audio')].find(el => !el.paused);
            if (audio) audio.currentTime = seekTime;
            schedule();
        }
    });

    // Position drifts from the estimate after seeks inside the page; re-send it from the element
    // that is actually playing whenever it seeks.
    document.addEventListener('seeked', event => {
        const target = event.target as HTMLMediaElement | null;
        if (!target || target.tagName !== 'AUDIO' || target.paused) return;
        position = target.currentTime;
        positionAt = Date.now();
        schedule();
    }, true);
};

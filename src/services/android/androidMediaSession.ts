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

interface LxMediaPlugin {
    update(options: LxMediaUpdate): Promise<void>;
    addListener(event: 'action', listener: (data: { action: string; seekTime?: number }) => void): Promise<PluginListenerHandle>;
}

const LxMedia = registerPlugin<LxMediaPlugin>('LxMedia');

type Handler = ((details: { action: string; seekTime?: number }) => void) | null;

const toHttpArtwork = (metadata: MediaMetadata | null): string => {
    const list = metadata?.artwork ?? [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const src = list[i]?.src ?? '';
        if (/^https?:\/\//i.test(src)) return src;
    }
    return '';
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

    const currentPosition = () => {
        if (playbackState !== 'playing') return position;
        const elapsed = ((Date.now() - positionAt) / 1000) * rate;
        const next = position + elapsed;
        return duration > 0 ? Math.min(next, duration) : next;
    };

    const push = () => {
        scheduled = false;
        const state: NativeState = metadata && playbackState !== 'none' ? playbackState as NativeState : (metadata ? 'paused' : 'none');
        const actions = [...handlers.entries()].filter(([, h]) => !!h).map(([name]) => name);
        LxMedia.update({
            title: metadata?.title ?? '',
            artist: metadata?.artist ?? '',
            album: metadata?.album ?? '',
            artwork: toHttpArtwork(metadata),
            state: metadata ? state : 'none',
            position: currentPosition(),
            duration: Number.isFinite(duration) ? duration : 0,
            rate,
            actions,
        }).catch(error => console.warn('[LxMedia] update failed', error));
    };

    const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(push);
    };

    const session = {
        get metadata() { return metadata; },
        set metadata(value: MediaMetadata | null) { metadata = value; schedule(); },
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
        return;
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

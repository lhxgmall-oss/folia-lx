import type { FoliumIconOptions, FoliumMount, FoliumRegistryHandle } from './contract';
import { createFoliumRegistry } from './registry';
import { createFoliumIcon } from './icons';
import { reportFoliumIssue } from './status';

// src/mods/folium/remoteUi.ts
// Experimental remote-only component slots. The host owns placement and cleanup;
// the mod owns every element, style and interaction inside its ShadowRoot.
export interface RemoteUiSnapshot {
    readonly trackKey: string | null;
    readonly title: string | null;
    readonly artist: string | null;
    readonly isPlaying: boolean;
    readonly isDaylight: boolean;
}
export interface RemoteUiContext {
    getSnapshot(): Readonly<RemoteUiSnapshot>;
    subscribe(listener: () => void): () => void;
    /** Ignore events from a removed registration and isolate rejected handlers. */
    run(handler: () => void | Promise<void>): Promise<boolean>;
}
export interface RemoteUiComponent {
    id: string;
    /** Reserved width in the horizontally scrollable 32px-high append area. */
    width: number;
    mount: FoliumMount<RemoteUiContext>;
}
const ownedListeners = new Map<string, Set<() => void>>();
export const remoteUiRegistry = createFoliumRegistry<RemoteUiComponent>('remote.ui', {
    validate: (def) => {
        if (typeof def.mount !== 'function' || !Number.isFinite(def.width) || def.width < 16 || def.width > 360) {
            throw new TypeError('remote.ui: mount and width (16–360) are required');
        }
        return Object.freeze({ id: def.id, width: def.width, mount: def.mount });
    },
    onRemove: (entry) => {
        ownedListeners.get(entry.id)?.forEach((listener) => listeners.delete(listener));
        ownedListeners.delete(entry.id);
    },
});

let snapshot: Readonly<RemoteUiSnapshot> = Object.freeze({ trackKey: null, title: null, artist: null, isPlaying: false, isDaylight: false });
const listeners = new Set<() => void>();
export const updateRemoteUiSnapshot = (next: RemoteUiSnapshot) => {
    if (Object.keys(next).every((key) => next[key as keyof RemoteUiSnapshot] === snapshot[key as keyof RemoteUiSnapshot])) return;
    snapshot = Object.freeze({ ...next });
    listeners.forEach((listener) => { try { listener(); } catch (error) { console.warn('[Folium] remote.ui subscription failed', error); } });
};
export const createRemoteUiContext = (id: string): RemoteUiContext => {
    const entry = remoteUiRegistry.get(id);
    const current = () => entry !== null && remoteUiRegistry.get(id) === entry;
    return Object.freeze({
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            const guarded = () => {
                if (!current()) return;
                try { listener(); } catch (error) { reportFoliumIssue(entry!.modId, 'remote.ui subscription', error); }
            };
            if (!current()) return () => {};
            const owned = ownedListeners.get(id) ?? new Set<() => void>();
            ownedListeners.set(id, owned);
            owned.add(guarded);
            listeners.add(guarded);
            return () => { listeners.delete(guarded); owned.delete(guarded); };
        },
        run: async (handler: () => void | Promise<void>) => {
            if (!current()) return false;
            try { await handler(); return true; }
            catch (error) { reportFoliumIssue(entry!.modId, 'remote.ui action', error); return false; }
        },
    });
};

/** Narrow API of the optional `remoteUi` export; stable client contexts stay unchanged. */
export const createRemoteUiApi = (modId: string, clientUrl: string, isCurrent: () => boolean, handles: Set<FoliumRegistryHandle>) => Object.freeze({
    register: (def: RemoteUiComponent) => {
        if (!isCurrent()) throw new Error('remote.ui: client is no longer active');
        const handle = remoteUiRegistry.register(modId, def);
        handles.add(handle);
        return handle;
    },
    icon: (name: string, options?: FoliumIconOptions) => createFoliumIcon(name, options),
    rpc: Object.freeze({
        call: async <T>(name: string, ...args: unknown[]): Promise<T> => {
            if (!isCurrent()) throw new Error('remote.ui: client is no longer active');
            const response = await window.electron?.mods?.invokeRemoteUiRpc(modId, clientUrl, name, args);
            if (!response?.ok) throw new Error(response?.error ?? 'remote.ui: bridge unavailable');
            return response.result as T;
        },
    }),
});
export type RemoteUiApi = ReturnType<typeof createRemoteUiApi>;

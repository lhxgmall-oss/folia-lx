import type { ModRuntimeInfo } from '../types';
import type { FoliumDisposer, FoliumRegistryHandle } from './contract';
import { createRemoteUiApi, type RemoteUiApi } from './remoteUi';
import { clearFoliumIssues, reportFoliumIssue } from './status';

// src/mods/folium/remoteUiLoader.ts
// Only the experimental named export is invoked in the companion renderer.
// Main-window activation and its side effects never run here a second time.
type RemoteModule = { remoteUi?: (api: RemoteUiApi) => void | FoliumDisposer | Promise<void | FoliumDisposer> };
const importClient = (url: string): Promise<RemoteModule> => import(/* @vite-ignore */ url);

export const remoteUiClientUrl = (mod: ModRuntimeInfo): string | null => {
    if (mod.status !== 'loaded' || !mod.experimental?.includes('remote.ui') || !mod.clientUrl) return null;
    try {
        const url = new URL(mod.clientUrl);
        return url.protocol === 'folia-mod:' && url.hostname === mod.id && !url.username && !url.password
            ? mod.clientUrl : null;
    } catch { return null; }
};

/** Serialized import/teardown, including a disable that arrives during an async activation. */
export const createRemoteUiClients = (load: typeof importClient = importClient) => {
    const active = new Map<string, { url: string; alive: boolean; handles: Set<FoliumRegistryHandle>; dispose?: FoliumDisposer }>();
    let serial = Promise.resolve();
    let desired = new Map<string, string>();
    const teardown = (modId: string) => {
        const record = active.get(modId);
        if (record) record.alive = false;
        active.delete(modId);
        try { record?.dispose?.(); }
        catch (error) { reportFoliumIssue(modId, 'remote.ui dispose', error); }
        record?.handles.forEach((handle) => handle.unregister());
    };
    return (mods: readonly ModRuntimeInfo[]): Promise<void> => {
        desired = new Map(mods.flatMap((mod) => {
            const url = remoteUiClientUrl(mod);
            return url ? [[mod.id, url] as const] : [];
        }));
        // Revoke callbacks immediately, even while an import is pending.
        active.forEach((record, id) => {
            if (desired.get(id) !== record.url) {
                record.alive = false;
                record.handles.forEach((handle) => handle.unregister());
            }
        });
        const run = async () => {
            for (const [id, record] of active) {
                if (!record.alive || desired.get(id) !== record.url) teardown(id);
            }
            for (const [id, url] of desired) {
                if (active.has(id) || desired.get(id) !== url) continue;
                const record = { url, alive: true, handles: new Set<FoliumRegistryHandle>(), dispose: undefined as FoliumDisposer | undefined };
                active.set(id, record);
                clearFoliumIssues(id);
                try {
                    const module = await load(url);
                    if (!record.alive || desired.get(id) !== url) { teardown(id); continue; }
                    if (typeof module.remoteUi !== 'function') throw new TypeError('remote.ui: client must export function remoteUi(remote)');
                    const result = await module.remoteUi(createRemoteUiApi(id, url, () => record.alive && desired.get(id) === url, record.handles));
                    if (typeof result === 'function') record.dispose = result;
                    if (!record.alive || desired.get(id) !== url) teardown(id);
                } catch (error) { teardown(id); reportFoliumIssue(id, 'remote.ui activate', error); }
            }
        };
        serial = serial.then(run, run);
        return serial;
    };
};

/** Subscribe before reading: a stale initial IPC response cannot re-enable a disabled mod. */
export const startRemoteUiClients = (): (() => void) => {
    const bridge = window.electron?.mods;
    if (!bridge?.listRemoteUiClients || !bridge.onRemoteUiClientsChanged) return () => {};
    const reconcile = createRemoteUiClients();
    let revision = 0;
    let stopped = false;
    const unsubscribe = bridge.onRemoteUiClientsChanged((mods) => {
        revision += 1;
        if (!stopped) void reconcile(mods);
    });
    const requestedAt = revision;
    void bridge.listRemoteUiClients().then((mods) => {
        if (!stopped && revision === requestedAt) void reconcile(mods);
    }).catch((error) => console.warn('[Folium] remote.ui bootstrap failed', error));
    return () => { stopped = true; unsubscribe(); void reconcile([]); };
};

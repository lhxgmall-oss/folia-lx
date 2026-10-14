import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModRuntimeInfo } from '../../../src/mods/types';
import { createRemoteUiContext, remoteUiRegistry, updateRemoteUiSnapshot } from '../../../src/mods/folium/remoteUi';
import { createRemoteUiClients, remoteUiClientUrl } from '../../../src/mods/folium/remoteUiLoader';
import { useFoliumStatusStore } from '../../../src/mods/folium/status';

// test/unit/mod-system/remoteUi.test.ts
const mod = (patch: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({ id: 'sample', status: 'loaded', experimental: ['remote.ui'], clientUrl: 'folia-mod://sample/client.mjs?v=1', ...patch } as ModRuntimeInfo);
afterEach(() => { remoteUiRegistry.list().forEach((entry) => remoteUiRegistry.unregister(entry.id)); vi.restoreAllMocks(); });

describe('experimental remote component lifecycle', () => {
    it('accepts only enabled opt-in clients from their own protocol origin', () => {
        expect(remoteUiClientUrl(mod())).toBe(mod().clientUrl);
        for (const patch of [{ status: 'disabled' }, { experimental: [] }, { clientUrl: 'https://sample/client.mjs' }, { clientUrl: 'folia-mod://another/client.mjs' }, { clientUrl: 'folia-mod://user@sample/client.mjs' }]) {
            expect(remoteUiClientUrl(mod(patch as Partial<ModRuntimeInfo>))).toBeNull();
        }
    });
    it('validates geometry and accepts arbitrary mount functions without a host button schema', () => {
        expect(() => remoteUiRegistry.register('sample', { id: 'input', width: 100, mount: () => {} })).not.toThrow();
        for (const width of [NaN, 0, 361]) expect(() => remoteUiRegistry.register('sample', { id: 'bad', width, mount: () => {} })).toThrow();
    });
    it('runs only the named remote export and disposes its own registrations on disable', async () => {
        const original = vi.fn(); const dispose = vi.fn();
        const reconcile = createRemoteUiClients(async () => ({ default: original, remoteUi(api) { api.register({ id: 'slot', width: 28, mount: () => {} }); return dispose; } }));
        await reconcile([mod()]); expect(original).not.toHaveBeenCalled(); expect(remoteUiRegistry.list()).toHaveLength(1);
        await reconcile([mod({ status: 'disabled' })]); expect(dispose).toHaveBeenCalledOnce(); expect(remoteUiRegistry.list()).toHaveLength(0);
    });
    it('does not activate an import that finished after disable', async () => {
        const activate = vi.fn(() => {});
        let resolve!: (value: { remoteUi: typeof activate }) => void;
        const reconcile = createRemoteUiClients(() => new Promise((done) => { resolve = done; }));
        const importing = reconcile([mod()]); await Promise.resolve(); const disabled = reconcile([]);
        resolve({ remoteUi: activate }); await importing; await disabled; expect(activate).not.toHaveBeenCalled();
    });
    it('never imports later clients from a superseded batch', async () => {
        let finish!: (module: {}) => void;
        const load = vi.fn(() => new Promise<{}>((resolve) => { finish = resolve; }));
        const reconcile = createRemoteUiClients(load);
        const activating = reconcile([mod(), mod({ id: 'second', clientUrl: 'folia-mod://second/client.mjs?v=1' })]);
        await Promise.resolve(); const disabled = reconcile([]); finish({}); await activating; await disabled;
        expect(load).toHaveBeenCalledTimes(1); expect(remoteUiRegistry.list()).toHaveLength(0);
    });
    it('removes mounted entries immediately when disable interrupts an async activation', async () => {
        let finish!: () => void; const dispose = vi.fn();
        const wait = new Promise<void>((resolve) => { finish = resolve; });
        const reconcile = createRemoteUiClients(async () => ({ async remoteUi(api) {
            api.register({ id: 'slot', width: 28, mount: () => {} }); await wait; return dispose;
        } }));
        const activating = reconcile([mod()]); await Promise.resolve(); await Promise.resolve();
        const context = createRemoteUiContext('sample:slot'); expect(remoteUiRegistry.list()).toHaveLength(1);
        const disabled = reconcile([]); expect(remoteUiRegistry.list()).toHaveLength(0);
        expect(await context.run(vi.fn())).toBe(false); finish(); await activating; await disabled;
        expect(dispose).toHaveBeenCalledOnce();
    });
    it('reloads changed code and removes partial registrations from a failed activation', async () => {
        const dispose = vi.fn();
        const reconcile = createRemoteUiClients(async (url) => ({ remoteUi(api) { api.register({ id: 'slot', width: 28, mount: () => {} }); if (url.endsWith('2')) throw new Error('broken'); return dispose; } }));
        await reconcile([mod()]); await reconcile([mod({ clientUrl: 'folia-mod://sample/client.mjs?v=2' })]);
        expect(dispose).toHaveBeenCalledOnce(); expect(remoteUiRegistry.list()).toHaveLength(0);
        expect(useFoliumStatusStore.getState().issues.sample.at(-1)?.message).toBe('broken');
    });
    it('stale contexts cannot act and subscriptions are removed with their registration', async () => {
        const registration = remoteUiRegistry.register('sample', { id: 'slot', width: 28, mount: () => {} });
        const context = createRemoteUiContext(registration.id); const action = vi.fn(); const listener = vi.fn(); context.subscribe(listener);
        updateRemoteUiSnapshot({ trackKey: '1', title: 'A', artist: null, isPlaying: false, isDaylight: false });
        expect(listener).toHaveBeenCalledOnce(); expect(Object.isFrozen(context.getSnapshot())).toBe(true);
        expect(await context.run(action)).toBe(true); registration.unregister();
        updateRemoteUiSnapshot({ trackKey: '2', title: 'B', artist: null, isPlaying: false, isDaylight: false });
        expect(listener).toHaveBeenCalledOnce(); expect(await context.run(action)).toBe(false); expect(action).toHaveBeenCalledOnce();
    });
    it('isolates action errors without losing other components', async () => {
        const registration = remoteUiRegistry.register('sample', { id: 'slot', width: 28, mount: () => {} });
        expect(await createRemoteUiContext(registration.id).run(async () => { throw new Error('action failed'); })).toBe(false);
        expect(remoteUiRegistry.list()).toHaveLength(1);
    });
});

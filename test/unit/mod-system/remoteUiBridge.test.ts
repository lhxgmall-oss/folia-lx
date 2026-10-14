import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/mod-system/remoteUiBridge.test.ts
const require = createRequire(import.meta.url);
const { createRemoteUiBridge, CHANNELS } = require('../../../electron/modSystem/remoteUiBridge.cjs');
const { validateManifest } = require('../../../electron/modSystem/manifest.cjs');
const setup = () => {
    const mainFrame = { url: 'file:///app/dist/index.html?remote=1' }; const contents = { mainFrame, isDestroyed: () => false, send: vi.fn() };
    const remote = { isDestroyed: () => false, webContents: contents };
    const mod = { id: 'sample', status: 'loaded', clientUrl: 'folia-mod://sample/client.mjs?v=1', experimental: ['remote.ui'] };
    const list = [mod, { ...mod, id: 'no-opt-in', experimental: [] }]; const invokeRpc = vi.fn(() => ({ ok: true, result: 1 }));
    const bridge = createRemoteUiBridge({ getRemoteWindow: () => remote, getRemoteEntryUrl: () => 'file:///app/dist/index.html?remote=1', listClients: () => list, invokeRpc });
    const handlers = new Map(); bridge.register({ handle: (name: string, handler: unknown) => handlers.set(name, handler) });
    return { bridge, handlers, mod, remote, contents, invokeRpc, event: { sender: contents, senderFrame: mainFrame } };
};
describe('remote.ui IPC boundary', () => {
    it('manifest recognizes the opt-in without promoting it to stable Folium', () => {
        const result = validateManifest({ id: 'sample', name: 'Sample', version: '1.0.0', folium: 1, client: 'client.mjs', experimental: ['remote.ui'] });
        expect(result.ok).toBe(true);
        expect(result.value.experimental).toEqual(['remote.ui']);
    });
    it('only lists opted-in loaded clients and sends lifecycle changes to the remote window', () => {
        const { bridge, handlers, contents, event, mod } = setup();
        expect(handlers.get(CHANNELS.list)(event)).toEqual([mod]); bridge.notify(); expect(contents.send).toHaveBeenCalledWith(CHANNELS.changed, [mod]);
    });
    it('rejects other windows and child frames before reading or invoking RPC', () => {
        const { handlers, event, mod, invokeRpc } = setup();
        for (const bad of [{ ...event, sender: {} }, { ...event, senderFrame: {} }]) {
            expect(() => handlers.get(CHANNELS.list)(bad)).toThrow('Untrusted');
            expect(() => handlers.get(CHANNELS.rpc)(bad, mod.id, mod.clientUrl, 'increment', [])).toThrow('Untrusted');
        }
        expect(invokeRpc).not.toHaveBeenCalled();
    });
    it('rechecks owner opt-in, enablement and code version at every RPC', () => {
        const { handlers, event, mod, invokeRpc } = setup(); const call = () => handlers.get(CHANNELS.rpc)(event, 'sample', 'folia-mod://sample/client.mjs?v=1', 'increment', []);
        expect(call()).toEqual({ ok: true, result: 1 }); expect(invokeRpc).toHaveBeenCalledWith('sample', 'increment', []);
        mod.status = 'disabled'; expect(call).toThrow('mod disabled'); mod.status = 'loaded';
        mod.experimental = []; expect(call).toThrow('not opted in'); mod.experimental = ['remote.ui'];
        mod.clientUrl = 'folia-mod://sample/client.mjs?v=2'; expect(call).toThrow('changed'); expect(invokeRpc).toHaveBeenCalledOnce();
    });
    it('rejects a trusted window navigated away from the exact remote app entry', () => {
        const { bridge, handlers, event, mod, invokeRpc, contents } = setup();
        for (const url of ['https://outside.example/?remote=1', 'file:///app/dist/other.html?remote=1', 'file:///app/dist/index.html', 'file:///app/dist/index.html?remote=0']) {
            contents.mainFrame.url = url;
            expect(() => handlers.get(CHANNELS.list)(event)).toThrow('Untrusted');
            expect(() => handlers.get(CHANNELS.rpc)(event, mod.id, mod.clientUrl, 'increment', [])).toThrow('Untrusted');
            bridge.notify();
        }
        expect(invokeRpc).not.toHaveBeenCalled(); expect(contents.send).not.toHaveBeenCalled();
    });
    it('does not dispatch events or requests through a destroyed window', () => {
        const { bridge, handlers, event, remote, contents } = setup(); remote.isDestroyed = () => true;
        expect(() => handlers.get(CHANNELS.list)(event)).toThrow('Untrusted'); bridge.notify(); expect(contents.send).not.toHaveBeenCalled();
    });
});

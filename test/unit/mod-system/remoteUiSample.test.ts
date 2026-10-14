import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';

// test/unit/mod-system/remoteUiSample.test.ts
// Run the actual sample Node module through modSystem, its trust/enable state,
// and the guarded remote IPC handlers. Only Electron transport is simulated.
const require = createRequire(import.meta.url);
const persisted = new Map<string, unknown>();
const handlers = new Map<string, (...args: any[]) => any>();
let protocolHandler: (request: Request) => Response;
const stubModule = (name: string, exports: unknown) => {
    const filename = require.resolve(name);
    require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module;
};
stubModule('electron-store', class {
    get(key: string) { return persisted.get(key); }
    set(key: string, value: unknown) { persisted.set(key, value); }
});
stubModule('electron', {
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler), removeHandler: (name: string) => handlers.delete(name) },
    dialog: { showMessageBox: async () => ({ response: 1 }) }, protocol: { handle: (_scheme: string, handler: typeof protocolHandler) => { protocolHandler = handler; } }, shell: { openPath: async () => '' },
});
const { createModSystem, IPC } = require('../../../electron/modSystem/modSystem.cjs');
const { CHANNELS } = require('../../../electron/modSystem/remoteUiBridge.cjs');

it('loads the offline sample, executes Node RPC, pushes disable and rejects stale calls', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-remote-ui-'));
    const sample = path.resolve('dev/folium/sample-remote-ui');
    const archive = path.join(root, 'sample.zip');
    fs.writeFileSync(archive, zipSync(Object.fromEntries(fs.readdirSync(sample).map((file) => [file, fs.readFileSync(path.join(sample, file))]))));
    const contents = { isDestroyed: () => false, mainFrame: { url: 'file:///app/dist/index.html?remote=1' }, send: vi.fn() };
    const remote = { isDestroyed: () => false, webContents: contents };
    const system = createModSystem({
        app: { getPath: () => path.join(root, 'user'), getAppPath: () => path.join(root, 'app'), getVersion: () => '0.7.19', isPackaged: true },
        BrowserWindow: { getAllWindows: () => [] }, getMainWindow: () => null, getRemoteWindow: () => remote, getRemoteEntryUrl: () => 'file:///app/dist/index.html?remote=1',
        getLocaleKey: () => 'en', isFeatureEnabled: () => true,
    });
    try {
        system.registerIpc(); system.loadAll();
        expect(await handlers.get(IPC.installZip)!(null, archive)).toMatchObject({ ok: true, id: 'sample-remote-ui' });
        expect(system.listClientDescriptors()).toEqual([]);
        expect(await handlers.get(IPC.setEnabled)!(null, 'sample-remote-ui', true)).toMatchObject({ ok: true });
        const event = { sender: contents, senderFrame: contents.mainFrame };
        const clients = handlers.get(CHANNELS.list)!(event);
        expect(clients).toHaveLength(1); expect(clients[0].id).toBe('sample-remote-ui');
        const response = protocolHandler(new Request(clients[0].clientUrl));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(fs.readFileSync(path.join(sample, 'client.mjs'), 'utf8'));
        const call = () => handlers.get(CHANNELS.rpc)!(event, clients[0].id, clients[0].clientUrl, 'increment', []);
        expect(await call()).toEqual({ ok: true, result: 1 }); expect(await call()).toEqual({ ok: true, result: 2 });
        await system.setModEnabled('sample-remote-ui', false);
        expect(contents.send).toHaveBeenLastCalledWith(CHANNELS.changed, []);
        expect(() => call()).toThrow('mod disabled');
        expect(protocolHandler(new Request(clients[0].clientUrl)).status).toBe(404);
    } finally { system.dispose(); fs.rmSync(root, { recursive: true, force: true }); }
});

'use strict';

const { createSenderGuardedHandler } = require('../ipcAccessGuard.cjs');

// electron/modSystem/remoteUiBridge.cjs
// Remote-only descriptors and owner-bound RPC reuse the ordinary mod loader.
// Window identity plus its main frame reject auxiliary windows and subframes;
// like other Folium APIs this is not a sandbox against an approved mod's code.
const CHANNELS = Object.freeze({ list: 'folia-mods:remote-ui-list', rpc: 'folia-mods:remote-ui-rpc', changed: 'folia-mods:remote-ui-changed' });

const createRemoteUiBridge = ({ getRemoteWindow, getRemoteEntryUrl, listClients, invokeRpc }) => {
    const currentWindow = () => {
        const win = getRemoteWindow?.();
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return null;
        try {
            const actual = new URL(win.webContents.mainFrame.url);
            const expected = new URL(getRemoteEntryUrl());
            actual.hash = ''; expected.hash = '';
            return actual.href === expected.href && expected.searchParams.get('remote') === '1' ? win : null;
        } catch { return null; }
    };
    const descriptors = () => listClients().filter((mod) => mod.status === 'loaded' && mod.clientUrl && mod.experimental?.includes('remote.ui'));
    const trusted = (event) => {
        const win = currentWindow();
        return Boolean(win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame);
    };
    const list = createSenderGuardedHandler({ isTrusted: trusted, channel: CHANNELS.list, handler: () => descriptors() });
    const rpc = createSenderGuardedHandler({
        isTrusted: trusted, channel: CHANNELS.rpc,
        handler: (_event, modId, clientUrl, name, args) => {
            const owner = descriptors().find((mod) => mod.id === modId && mod.clientUrl === clientUrl);
            if (!owner) throw new Error('remote.ui: mod disabled, changed or not opted in');
            if (typeof name !== 'string' || !Array.isArray(args)) throw new TypeError('remote.ui: invalid RPC arguments');
            return invokeRpc(modId, name, args);
        },
    });
    return {
        register: (ipcMain) => { ipcMain.handle(CHANNELS.list, list); ipcMain.handle(CHANNELS.rpc, rpc); },
        notify: () => currentWindow()?.webContents.send(CHANNELS.changed, descriptors()),
    };
};
module.exports = { CHANNELS, createRemoteUiBridge };

import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// test/unit/lx/lxUserApiManager.test.ts
// Importing, choosing and removing custom source scripts, with the script really running in a
// child process (electron/lx/userApi/scriptHost.cjs) as it does under Electron's utilityProcess.

const require = createRequire(import.meta.url);
const { createUserApiManager } = require('../../../electron/lx/userApi/userApiManager.cjs');
const { spawnScriptHost } = require('../../../electron/lx/lxDesktop.cjs');

const SCRIPT = (name: string, answer = 'https://cdn.example/a.mp3') => `/**
 * @name ${name}
 * @version 1.0.0
 */
lx.on(lx.EVENT_NAMES.request, () => Promise.resolve('${answer}'))
lx.send(lx.EVENT_NAMES.inited, { sources: { tx: { type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k'] } } })
`;

const dirs: string[] = [];
const managers: any[] = [];
const make = () => {
    const dir = mkdtempSync(join(tmpdir(), 'lx-manager-'));
    dirs.push(dir);
    const manager = createUserApiManager({
        baseDir: () => dir,
        spawnHost: () => spawnScriptHost(null),
        fetchText: async () => SCRIPT('from-url'),
        log: {},
    });
    managers.push(manager);
    return { dir, manager };
};

afterEach(() => {
    managers.splice(0).forEach(manager => manager.dispose());
    dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
});

describe('userApiManager', () => {
    it('imports a script, runs it in its own process and asks it for a URL', async () => {
        const { dir, manager } = make();
        const api = manager.importScript(SCRIPT('one'));
        expect(api).toMatchObject({ name: 'one', version: '1.0.0' });
        expect(api.hash).toBeUndefined();
        expect(manager.getState().activeId).toBe(api.id);
        expect(await manager.declaredSources()).toEqual({ tx: { type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k'] } });
        await expect(manager.ask('tx', 'musicUrl', { type: '128k', musicInfo: {} })).resolves.toEqual({ type: '128k', url: 'https://cdn.example/a.mp3' });
        await expect(manager.ask('kw', 'musicUrl', { type: '128k', musicInfo: {} })).rejects.toThrow(/does not support/);
        expect(manager.getState().status.state).toBe('ready');
        expect(existsSync(join(dir, 'index.json'))).toBe(true);
        expect(readdirSync(join(dir, 'scripts'))).toHaveLength(1);
    }, 20_000);

    it('refuses the same script twice and a file without a header', () => {
        const { manager } = make();
        manager.importScript(SCRIPT('one'));
        expect(() => manager.importScript(SCRIPT('one'))).toThrow(/相同/);
        expect(() => manager.importScript('lx.send()')).toThrow();
    });

    it('imports from a URL, switches and removes scripts, and keeps settings', async () => {
        const { dir, manager } = make();
        const first = manager.importScript(SCRIPT('one'));
        const second = await manager.importFromUrl('https://example.com/s.js');
        expect(manager.getState().activeId).toBe(first.id);
        manager.activate(second.id);
        expect(manager.getState().activeId).toBe(second.id);
        manager.remove(second.id);
        expect(manager.getState()).toMatchObject({ activeId: first.id, apis: [{ id: first.id }] });
        expect(manager.setSettings({ subSource: 'wy', quality: 'flac', fallback: false, junk: 1 })).toEqual({ subSource: 'wy', quality: 'flac', fallback: false });
        expect(manager.setSettings({ subSource: 'nope' }).subSource).toBe('all');
        await expect(manager.importFromUrl('file:///etc/passwd')).rejects.toThrow();
        // A new manager over the same folder reads what was kept.
        const again = createUserApiManager({ baseDir: () => dir, spawnHost: () => spawnScriptHost(null), fetchText: async () => '', log: {} });
        expect(again.getState()).toMatchObject({ activeId: first.id, settings: { subSource: 'all', quality: 'flac', fallback: false } });
        again.dispose();
    }, 20_000);

    it('reports a script that fails to load', async () => {
        const { manager } = make();
        manager.importScript('/**\n * @name bad\n */\nthrow new Error("broken script")');
        expect(await manager.declaredSources()).toEqual({});
        expect(manager.getState().status).toMatchObject({ state: 'error', message: 'broken script' });
        await expect(manager.ask('tx', 'musicUrl', {})).rejects.toThrow('broken script');
    }, 20_000);
});

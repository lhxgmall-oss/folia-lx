import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// The host owns IPC, OS encryption and media registration; protocol tests live with the npm package.
const require = createRequire(import.meta.url);
const { createQishuiApiBridge } = require('../../../electron/qishui/qishuiApiBridge.cjs');
const { createSessionRepository, SESSION_KEY, DEVICE_KEY } = require('../../../electron/qishui/session.cjs');
const { createQishuiMediaPolicy } = require('../../../electron/qishui/mediaCors.cjs');
const store = () => {
    const values = new Map<string, unknown>();
    return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
};
const cipher = () => ({ isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'keychain',
    encryptString: (text: string) => Buffer.from(Buffer.from(text).map(byte => byte ^ 0xa5)),
    decryptString: (bytes: Buffer) => Buffer.from(bytes.map(byte => byte ^ 0xa5)).toString() });
const account = { userId: 'opaque-account', user: { id: 'opaque-account', nickname: 'Listener' }, ticket: 'fixture-private-ticket',
    guardKey: 'fixture-key', guardCert: 'fixture-certificate', guardTsSign: 'fixture-signature', accessCode: 'fixture-access', expiresAt: Date.now() + 7200000 };

describe('Qishui desktop bridge', () => {
    it('rejects unregistered IPC operations before invoking the package', async () => {
        const request = vi.fn();
        const bridge = createQishuiApiBridge({ store: store(), apiFactory: () => ({ request }) });
        for (const operation of ['fetch', 'constructor', 'like_song', 'playlist_edit']) {
            expect(await bridge.request(operation)).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        }
        expect(request).not.toHaveBeenCalled();
    });
    it('delegates parameter validation to the real package before network access', async () => {
        const fetch = vi.fn();
        const bridge = createQishuiApiBridge({ store: store(), fetch });
        for (const params of [null, [], { query: {} }, { query: 'x', offset: -1 }]) {
            expect(await bridge.request('search', params)).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        }
        expect(fetch).not.toHaveBeenCalled();
    });
    it('injects the host dependencies and preserves safe package errors', async () => {
        const result = { ok: false, error: { code: 'auth-required', message: 'Sign in required', stage: 'account' } };
        const apiFactory = vi.fn((_options: unknown) => ({ request: vi.fn().mockResolvedValue(result) }));
        const fetch = vi.fn(), log = vi.fn();
        const bridge = createQishuiApiBridge({ store: store(), apiFactory, fetch, log });
        expect(apiFactory.mock.calls[0][0]).toMatchObject({ deviceId: expect.stringMatching(/^\d{19}$/), fetch, log,
            sessions: { get: expect.any(Function), set: expect.any(Function), clear: expect.any(Function) } });
        expect(await bridge.request('login_status')).toEqual(result);
    });
    it('keeps unexpected exception text out of IPC', async () => {
        const bridge = createQishuiApiBridge({ store: store(), apiFactory: () => ({ request: () => { throw new Error('fixture-private'); } }) });
        const result = await bridge.request('search', { query: 'x' });
        expect(result).toEqual({ ok: false, error: { code: 'invalid-response', message: 'Qishui operation failed' } });
    });
    it('restores existing V1 encrypted sessions and the saved device ID, and clears them on logout', async () => {
        const saved = store(), safeStorage = cipher();
        const previous = createSessionRepository({ store: saved, safeStorage });
        previous.set({ ...account, deviceId: previous.deviceId });
        expect(Buffer.from(String(saved.get(SESSION_KEY)), 'base64').toString()).not.toContain('fixture-private-ticket');
        const restored = createSessionRepository({ store: saved, safeStorage });
        expect(restored.deviceId).toBe(previous.deviceId);
        expect(restored.get()).toMatchObject(account);
        const fetch = vi.fn();
        const bridge = createQishuiApiBridge({ store: saved, safeStorage, fetch, log: vi.fn() });
        expect(await bridge.request('logout')).toEqual({ ok: true, data: null });
        expect(saved.get(SESSION_KEY)).toBeUndefined();
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each([false, true])('keeps sessions in memory when encryption is unavailable/basic_text (%s)', basicText => {
        const saved = store();
        const sessions = createSessionRepository({ store: saved, safeStorage: { ...cipher(), isEncryptionAvailable: () => basicText,
            getSelectedStorageBackend: () => 'basic_text' }, warn: vi.fn() });
        sessions.set(account);
        expect(sessions.get()).toMatchObject(account);
        expect(saved.get(SESSION_KEY)).toBeUndefined();
        expect(createSessionRepository({ store: saved, safeStorage: cipher() }).get()).toBeNull();
    });
    it('uses the package device-ID functions while preserving the published storage key', () => {
        const saved = store();
        saved.set(DEVICE_KEY, 'malformed');
        const sessions = createSessionRepository({ store: saved });
        expect(sessions.deviceId).toMatch(/^\d{19}$/);
        expect(saved.get('QISHUI_DEVICE_ID')).toBe(sessions.deviceId);
    });
    it('registers only successful audio responses with the media policy', async () => {
        const policy = createQishuiMediaPolicy(), url = 'https://v26-default.365yg.com/audio';
        const request = vi.fn().mockResolvedValueOnce({ ok: true, data: { url } }).mockResolvedValueOnce({ ok: false, error: { code: 'network' } });
        const register = vi.fn(policy.register);
        const bridge = createQishuiApiBridge({ store: store(), apiFactory: () => ({ request }), onAudioSource: register });
        await bridge.request('audio', { id: '123', quality: 'standard' });
        await bridge.request('audio', { id: '456', quality: 'standard' });
        expect(register).toHaveBeenCalledExactlyOnceWith(url);
        expect(policy.allows({ url, resourceType: 'media', method: 'GET' })).toBe(true);
        expect(policy.allows({ url: 'https://other.example.test/audio', resourceType: 'media', method: 'GET' })).toBe(false);
    });
});

import { afterEach, describe, expect, it } from 'vitest';
import { getLxTransportAvailability } from '../../../src/services/onlineMusic/lx/lxTransport';

// test/unit/lx/lxAndroidTransport.test.ts
// lxTransport.ts takes the Android path where Capacitor says the page is the Android app, the desktop
// path where Electron's bridge is there, and is unavailable otherwise (the web build).

const g = globalThis as unknown as { window?: unknown };

describe('getLxTransportAvailability', () => {
    afterEach(() => { delete g.window; });

    it('is unavailable on the web', () => {
        g.window = {};
        expect(getLxTransportAvailability()).toEqual({ configured: false, reason: 'runtime-unavailable' });
    });

    it('is available in the Android app', () => {
        g.window = { Capacitor: { getPlatform: () => 'android' } };
        expect(getLxTransportAvailability()).toEqual({ configured: true });
    });

    it('is available on desktop', () => {
        g.window = { electron: { lxRequest: async () => ({ ok: true, data: null }) } };
        expect(getLxTransportAvailability()).toEqual({ configured: true });
    });
});

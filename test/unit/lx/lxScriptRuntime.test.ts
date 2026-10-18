import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/lx/lxScriptRuntime.test.ts
// The custom source script runtime (electron/lx/userApi/scriptRuntime.cjs): the lx.* API a script
// sees, what it may answer, and how a script that fails to load is reported.

const require = createRequire(import.meta.url);
const { createLxRuntime, parseScriptInfo } = require('../../../electron/lx/userApi/scriptRuntime.cjs');

const HEADER = '/**\n * @name 测试源\n * @description test\n * @version 2.1.0\n * @author me\n * @homepage https://example.com\n */\n';
const noRequest = () => ({ promise: Promise.reject(new Error('no network in tests')), abort() {} });

const script = (body: string) => HEADER + body;

describe('parseScriptInfo', () => {
    it('reads the header comment', () => {
        expect(parseScriptInfo(script(''))).toEqual({ name: '测试源', description: 'test', version: '2.1.0', author: 'me', homepage: 'https://example.com' });
    });
    it('refuses a script without one', () => {
        expect(() => parseScriptInfo('lx.send()')).toThrow();
    });
});

describe('createLxRuntime', () => {
    it('loads a script, keeps the sources LX accepts, and answers musicUrl', async () => {
        const runtime = createLxRuntime({
            request: noRequest,
            script: script(`
                const { EVENT_NAMES, on, send, utils } = globalThis.lx
                on(EVENT_NAMES.request, async ({ source, action, info }) => {
                    if (typeof require !== 'undefined' || typeof process !== 'undefined') throw new Error('node leaked')
                    return 'https://u/' + source + '/' + info.musicInfo.songmid + '/' + info.type + '/' + utils.crypto.md5('a').slice(0, 4)
                })
                send(EVENT_NAMES.inited, { sources: {
                    kw: { type: 'music', actions: ['musicUrl', 'bogus'], qualitys: ['128k', '320k', 'weird'] },
                    xm: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] },
                    tx: { type: 'video', actions: ['musicUrl'], qualitys: ['128k'] },
                } })
            `),
        });
        const sources = await runtime.ready;
        expect(sources).toEqual({ kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k'] } });
        const answer = await runtime.handle({ source: 'kw', action: 'musicUrl', info: { type: '320k', musicInfo: { songmid: '9' } } });
        expect(answer).toEqual({ type: '320k', url: 'https://u/kw/9/320k/0cc1' });
    });

    it('refuses an answer that is not a URL', async () => {
        const runtime = createLxRuntime({
            request: noRequest,
            script: script(`
                lx.on('request', () => Promise.resolve('javascript:alert(1)'))
                lx.send('inited', { sources: { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } })
            `),
        });
        await runtime.ready;
        await expect(runtime.handle({ source: 'kw', action: 'musicUrl', info: { type: '128k', musicInfo: {} } })).rejects.toThrow(/not a URL/);
    });

    it('reports a script that throws while loading', async () => {
        const runtime = createLxRuntime({ request: noRequest, script: script('throw new Error("boom")') });
        await expect(runtime.ready).rejects.toThrow('boom');
    });

    it('reports a script that never says it is ready', async () => {
        const runtime = createLxRuntime({ request: noRequest, script: script('lx.on("request", () => {})'), initTimeoutMs: 20 });
        await expect(runtime.ready).rejects.toThrow(/inited/);
    });

    it('passes lx.request through to the host request and back in the LX callback shape', async () => {
        const seen: any[] = [];
        const request = (url: string, options: any) => {
            seen.push([url, options]);
            return { promise: Promise.resolve({ statusCode: 200, statusMessage: 'OK', headers: {}, bytes: 2, raw: Buffer.from('{}'), body: { ok: 1 } }), abort() {} };
        };
        const runtime = createLxRuntime({
            request,
            script: script(`
                lx.on('request', ({ info }) => new Promise((resolve, reject) => {
                    lx.request('https://api/x', { method: 'post', body: { a: 1 }, headers: { k: 'v' } }, (err, resp, body) => {
                        if (err) return reject(err)
                        resolve('https://ok/' + resp.statusCode + '/' + body.ok)
                    })
                }))
                lx.send('inited', { sources: { wy: { type: 'music', actions: ['musicUrl'], qualitys: ['flac'] } } })
            `),
        });
        await runtime.ready;
        await expect(runtime.handle({ source: 'wy', action: 'musicUrl', info: { type: 'flac', musicInfo: {} } }))
            .resolves.toEqual({ type: 'flac', url: 'https://ok/200/1' });
        expect(seen[0][0]).toBe('https://api/x');
        expect(seen[0][1]).toMatchObject({ method: 'post', body: { a: 1 }, headers: { k: 'v' } });
    });

    it('lets the script show its update notice once', async () => {
        const alerts: any[] = [];
        const runtime = createLxRuntime({
            request: noRequest,
            onUpdateAlert: (alert: any) => alerts.push(alert),
            script: script(`
                lx.send('updateAlert', { log: 'v3 is out', updateUrl: 'https://example.com/v3' })
                lx.send('updateAlert', { log: 'again' }).catch(() => {})
                lx.send('inited', { sources: {} })
            `),
        });
        await runtime.ready;
        expect(alerts).toEqual([{ log: 'v3 is out', updateUrl: 'https://example.com/v3' }]);
    });
});

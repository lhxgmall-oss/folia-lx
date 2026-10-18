import { createRequire } from 'node:module';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// test/unit/lx/lxHttp.test.ts
// The needle-like request LX code goes through (electron/lx/lxHttp.cjs), against a local server.

const require = createRequire(import.meta.url);
const { lxRequest } = require('../../../electron/lx/lxHttp.cjs');

let server: http.Server;
let base = '';

beforeAll(async () => {
    server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            if (req.url === '/gzip') {
                res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'application/json' });
                res.end(zlib.gzipSync(JSON.stringify({ hello: '世界' })));
            } else if (req.url === '/echo') {
                res.writeHead(200);
                res.end(JSON.stringify({ method: req.method, type: req.headers['content-type'], body, ua: req.headers['user-agent'] }));
            } else if (req.url === '/redirect') {
                res.writeHead(302, { location: '/text' });
                res.end();
            } else if (req.url === '/text') {
                res.writeHead(200);
                res.end('plain text');
            } else if (req.url === '/slow') {
                setTimeout(() => res.end('late'), 500);
            }
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

describe('lxRequest', () => {
    it('decodes gzip and parses JSON', async () => {
        const resp = await lxRequest(`${base}/gzip`).promise;
        expect(resp.statusCode).toBe(200);
        expect(resp.body).toEqual({ hello: '世界' });
    });

    it('sends form and JSON bodies', async () => {
        const form = await lxRequest(`${base}/echo`, { method: 'post', form: { a: '1', b: 'x y' }, headers: { 'User-Agent': 'lx' } }).promise;
        expect(form.body).toEqual({ method: 'POST', type: 'application/x-www-form-urlencoded', body: 'a=1&b=x+y', ua: 'lx' });
        const json = await lxRequest(`${base}/echo`, { method: 'post', body: { k: [1] } }).promise;
        expect(json.body).toMatchObject({ type: 'application/json', body: '{"k":[1]}' });
    });

    it('does not follow a redirect unless asked', async () => {
        expect((await lxRequest(`${base}/redirect`).promise).statusCode).toBe(302);
        const followed = await lxRequest(`${base}/redirect`, { follow_max: 2 }).promise;
        expect(followed.body).toBe('plain text');
    });

    it('times out and can be aborted', async () => {
        await expect(lxRequest(`${base}/slow`, { timeout: 50 }).promise).rejects.toMatchObject({ code: 'ETIMEDOUT' });
        const pending = lxRequest(`${base}/slow`);
        pending.abort();
        await expect(pending.promise).rejects.toMatchObject({ code: 'ECANCELLED' });
    });

    it('refuses other protocols', async () => {
        await expect(lxRequest('file:///etc/passwd').promise).rejects.toThrow(/Unsupported protocol/);
    });
});

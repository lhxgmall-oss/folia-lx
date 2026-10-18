import nodeCrypto from 'node:crypto';
import nodeZlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as cryptoShim from '../../../capacitor/lx/shims/crypto.js';
import * as zlibShim from '../../../capacitor/lx/shims/zlib.js';
import * as fsShim from '../../../capacitor/lx/shims/fs.js';
import * as pathShim from '../../../capacitor/lx/shims/path.js';

// test/unit/lx/lxAndroidShims.test.ts
// The Node stand-ins the Android LX core runs on (capacitor/lx/shims): each one answers what Node's own
// module answers for the calls the musicSdk, the bridge and lx.utils make.

const WY_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----';

// The shims are plain JS; their inferred types are looser than Node's.
/* eslint-disable @typescript-eslint/no-explicit-any */
const crypto: any = cryptoShim;
const zlib: any = zlibShim;
const fs: any = fsShim;
const path: any = pathShim;

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);

describe('crypto shim', () => {
    it('hashes like node', () => {
        for (const algorithm of ['md5', 'sha1', 'sha256']) {
            expect(crypto.createHash(algorithm).update('洛雪 abc').digest('hex')).toBe(nodeCrypto.createHash(algorithm).update('洛雪 abc').digest('hex'));
            expect(Buffer.from(crypto.createHash(algorithm).update(Buffer.from(bytes(100))).digest()).toString('hex'))
                .toBe(nodeCrypto.createHash(algorithm).update(Buffer.from(bytes(100))).digest('hex'));
        }
    });

    it('encrypts and decrypts AES like node (ecb / cbc, padded)', () => {
        const key = Buffer.from('0CoJUm6Qyw8W8jud');
        const iv = Buffer.from('0102030405060708');
        for (const length of [0, 5, 16, 33]) {
            const data = Buffer.from(bytes(length));
            for (const [mode, ivArg] of [['aes-128-ecb', ''], ['aes-128-cbc', iv]] as const) {
                const ours = crypto.createCipheriv(mode, key, ivArg);
                const out = Buffer.concat([ours.update(data), ours.final()]);
                const theirs = nodeCrypto.createCipheriv(mode, key, ivArg || null);
                expect(out.toString('hex')).toBe(Buffer.concat([theirs.update(data), theirs.final()]).toString('hex'));
                const back = crypto.createDecipheriv(mode, key, ivArg);
                expect(Buffer.concat([back.update(out), back.final()]).toString('hex')).toBe(data.toString('hex'));
            }
        }
    });

    it('does RSA without padding like node', () => {
        const data = Buffer.concat([Buffer.alloc(112), Buffer.from('abcdefghijklmnop')]);
        const ours = Buffer.from(crypto.publicEncrypt({ key: WY_PUBLIC_KEY, padding: crypto.constants.RSA_NO_PADDING }, data)).toString('hex');
        const theirs = nodeCrypto.publicEncrypt({ key: WY_PUBLIC_KEY, padding: nodeCrypto.constants.RSA_NO_PADDING }, data).toString('hex');
        expect(ours).toBe(theirs);
    });

    it('gives random bytes', () => {
        expect(crypto.randomBytes(16)).toHaveLength(16);
    });
});

describe('zlib shim', () => {
    const text = Buffer.from('洛雪音乐 lyric line\n'.repeat(200));

    it('reads what node writes', async () => {
        expect(Buffer.from(zlib.inflateSync(nodeZlib.deflateSync(text))).equals(text)).toBe(true);
        expect(Buffer.from(zlib.inflateRawSync(nodeZlib.deflateRawSync(text))).equals(text)).toBe(true);
        expect(Buffer.from(zlib.gunzipSync(nodeZlib.gzipSync(text))).equals(text)).toBe(true);
        const viaCallback = await new Promise<Buffer>((resolve, reject) => zlib.inflate(nodeZlib.deflateSync(text), (error: Error | null, out: Buffer) => (error ? reject(error) : resolve(out))));
        expect(Buffer.from(viaCallback).equals(text)).toBe(true);
    });

    it('writes what node reads', async () => {
        const deflated = await new Promise<Buffer>((resolve, reject) => zlib.deflate(text, (error: Error | null, out: Buffer) => (error ? reject(error) : resolve(out))));
        expect(nodeZlib.inflateSync(Buffer.from(deflated)).equals(text)).toBe(true);
    });

    it('answers what it decoded of a cut-off stream with Z_SYNC_FLUSH, and fails without it', async () => {
        const cut = nodeZlib.deflateSync(text).subarray(0, -6);
        const nodeOut = await new Promise<Buffer>((resolve, reject) => nodeZlib.inflate(cut, { finishFlush: nodeZlib.constants.Z_SYNC_FLUSH }, (error, out) => (error ? reject(error) : resolve(out))));
        const ours = await new Promise<Buffer>((resolve, reject) => zlib.inflate(cut, { finishFlush: zlib.constants.Z_SYNC_FLUSH }, (error: Error | null, out: Buffer) => (error ? reject(error) : resolve(out))));
        expect(Buffer.from(ours).toString()).toBe(nodeOut.toString());
        expect(() => zlib.inflateSync(cut)).toThrow();
        expect(() => zlib.inflateSync(Buffer.from('not zlib at all'))).toThrow();
    });
});

describe('fs / path shims', () => {
    it('keeps files in memory and writes through renames, not temp files', () => {
        const writes: string[] = [];
        const removes: string[] = [];
        fs.mountVfs({ entries: { '/a/index.json': '{"x":1}' }, persist: { write: (p: string) => writes.push(p), remove: (p: string) => removes.push(p) } });
        expect(fs.readFileSync('/a/index.json', 'utf8')).toBe('{"x":1}');
        fs.writeFileSync('/a/index.json.tmp', '{"x":2}');
        expect(writes).toEqual([]);
        fs.renameSync('/a/index.json.tmp', '/a/index.json');
        expect(writes).toEqual(['/a/index.json']);
        expect(fs.readFileSync(path.join('/a', 'index.json'), 'utf8')).toBe('{"x":2}');
        fs.rmSync('/a/index.json', { force: true });
        expect(removes).toEqual(['/a/index.json']);
        expect(() => fs.readFileSync('/a/index.json', 'utf8')).toThrow(/ENOENT/);
        expect(path.dirname('/a/b/c.json')).toBe('/a/b');
    });
});

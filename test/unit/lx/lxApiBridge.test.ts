import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// test/unit/lx/lxApiBridge.test.ts
// The main-process bridge with a fake musicSdk and a fake script manager: aggregated search, the
// quality asked of the script, and the fallback to another sub-source.

const require = createRequire(import.meta.url);
const { createLxApiBridge, pickQuality, interleave } = require('../../../electron/lx/lxApiBridge.cjs');
const { pickMatches } = require('../../../electron/lx/musicSdk/lxMusicSdk.cjs');

const row = (source: string, n: number, extra: Record<string, unknown> = {}) => ({
    name: `song ${n}`, singer: 'S', source, songmid: `${source}${n}`, interval: '03:00', img: `http://img/${source}${n}`, types: [], ...extra,
});

const fakeSdk = (overrides: Record<string, any> = {}) => {
    const sources: Record<string, any> = {};
    for (const source of ['kw', 'kg', 'tx', 'wy', 'mg']) {
        sources[source] = {
            musicSearch: { search: async (_q: string, page: number, limit: number) => ({ list: Array.from({ length: limit + (source === 'mg' ? 2 : 0) }, (_, i) => row(source, (page - 1) * limit + i)), total: 100, allPage: 5 }) },
            songList: { sortList: [{ id: 'hot' }], getList: async () => ({ list: [{ id: 'l1', source }], total: 1 }), getListDetail: async () => ({ list: [row(source, 1)], total: 1, info: { name: 'L' } }) },
            getLyric: async () => ({ lyric: '[00:01.00]x' }),
            getPic: async () => 'http://pic',
            ...overrides[source],
        };
    }
    return { sources, setRequester() {}, pickMatches };
};

const fakeManager = (settings: Record<string, unknown> = {}, sources: Record<string, any> = {}, ask?: (s: string, a: string, info: any) => Promise<any>) => {
    const asked: any[] = [];
    return {
        asked,
        getSettings: () => ({ subSource: 'all', quality: 'follow', fallback: true, ...settings }),
        getState: () => ({ status: { message: '' } }),
        declaredSources: async () => sources,
        ask: async (source: string, action: string, info: any) => {
            asked.push([source, action, info]);
            if (ask) return ask(source, action, info);
            return { url: `https://play/${source}/${info.musicInfo.songmid}/${info.type}` };
        },
    };
};

const allQualities = { type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac', 'flac24bit'] };

describe('pickQuality', () => {
    it('takes the highest level at or below the wanted one that both sides have', () => {
        expect(pickQuality('flac24bit', ['128k', '320k', 'flac'], [])).toBe('flac');
        expect(pickQuality('flac', ['128k', '320k', 'flac'], ['128k', '320k'])).toBe('320k');
        expect(pickQuality('128k', ['320k', 'flac'], [])).toBe('320k');
        expect(pickQuality('320k', [], [])).toBeNull();
    });
    it('interleaves lists', () => {
        expect(interleave([[1, 2, 3], [4], [5, 6]])).toEqual([1, 4, 5, 2, 6, 3]);
    });
});

describe('createLxApiBridge', () => {
    it('searches every sub-source in turn and keeps each one to its share', async () => {
        const bridge = createLxApiBridge({ sdk: fakeSdk(), request: () => ({}), manager: fakeManager(), log: {} });
        const result = await bridge.request('search', { query: 'q', page: 1, limit: 10 });
        expect(result.ok).toBe(true);
        expect(result.data.list.map((r: any) => r.source)).toEqual(['kw', 'kg', 'tx', 'wy', 'mg', 'kw', 'kg', 'tx', 'wy', 'mg']);
        expect(result.data.total).toBe(500);
        expect(result.data.hasMore).toBe(true);
    });

    it('leaves out a sub-source that fails, and fails only when all do', async () => {
        const broken = { musicSearch: { search: async () => { throw new Error('down'); } } };
        const some = createLxApiBridge({ sdk: fakeSdk({ kw: broken, kg: broken }), request: () => ({}), manager: fakeManager(), log: {} });
        const partial = await some.request('search', { query: 'q', limit: 5 });
        expect(partial.ok).toBe(true);
        expect(partial.data.sources.filter((s: any) => !s.ok).map((s: any) => s.source)).toEqual(['kw', 'kg']);
        const all = createLxApiBridge({
            sdk: fakeSdk({ kw: broken, kg: broken, tx: broken, wy: broken, mg: broken }), request: () => ({}), manager: fakeManager(), log: {},
        });
        expect(await all.request('search', { query: 'q' })).toEqual({ ok: false, error: { code: 'invalid-response', message: 'down' } });
    });

    it('searches one sub-source where settings choose it', async () => {
        const bridge = createLxApiBridge({ sdk: fakeSdk(), request: () => ({}), manager: fakeManager({ subSource: 'tx' }), log: {} });
        const result = await bridge.request('search', { query: 'q', page: 2, limit: 3 });
        expect(result.data.list.map((r: any) => r.songmid)).toEqual(['tx3', 'tx4', 'tx5']);
    });

    it('asks the script at the quality the player wants, capped by what the script declared', async () => {
        const manager = fakeManager({}, { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k'] } });
        const bridge = createLxApiBridge({ sdk: fakeSdk(), request: () => ({}), manager, log: {} });
        const result = await bridge.request('music_url', { source: 'kw', musicInfo: row('kw', 1), quality: 'lossless' });
        expect(result.data).toMatchObject({ url: 'https://play/kw/kw1/320k', quality: 'high', source: 'kw' });
        expect(result.data.fallbackFrom).toBeUndefined();
    });

    it('uses the quality set in settings over the player one', async () => {
        const manager = fakeManager({ quality: '128k' }, { kw: allQualities });
        const bridge = createLxApiBridge({ sdk: fakeSdk(), request: () => ({}), manager, log: {} });
        const result = await bridge.request('music_url', { source: 'kw', musicInfo: row('kw', 1), quality: 'hires' });
        expect(result.data.quality).toBe('standard');
    });

    it('finds the same song on another sub-source when the script fails', async () => {
        const manager = fakeManager({}, { kw: allQualities, tx: allQualities }, async (source, _action, info) => {
            if (source === 'kw') throw new Error('kw refused');
            return { url: `https://play/${source}/${info.musicInfo.songmid}` };
        });
        const sdk = fakeSdk({ tx: { musicSearch: { search: async () => ({ list: [row('tx', 9, { name: 'other' }), row('tx', 1, { name: 'song 1' })], total: 2, allPage: 1 }) } } });
        const bridge = createLxApiBridge({ sdk, request: () => ({}), manager, log: {} });
        const result = await bridge.request('music_url', { source: 'kw', musicInfo: row('kw', 1), quality: 'high' });
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ source: 'tx', fallbackFrom: 'kw', url: 'https://play/tx/tx1' });
    });

    it('does not fall back where settings turn it off', async () => {
        const manager = fakeManager({ fallback: false }, { kw: allQualities, tx: allQualities }, async () => { throw new Error('kw refused'); });
        const bridge = createLxApiBridge({ sdk: fakeSdk(), request: () => ({}), manager, log: {} });
        const result = await bridge.request('music_url', { source: 'kw', musicInfo: row('kw', 1), quality: 'high' });
        expect(result).toEqual({ ok: false, error: { code: 'invalid-response', message: 'kw refused' } });
        expect(manager.asked).toHaveLength(1);
    });

    it('says when there is no script', async () => {
        const bridge = createLxApiBridge({ sdk: fakeSdk(), request: () => ({}), manager: fakeManager({}, {}), log: {} });
        const result = await bridge.request('music_url', { source: 'kw', musicInfo: row('kw', 1), quality: 'high' });
        expect(result.ok).toBe(false);
        expect(result.error.code).toBe('unavailable');
    });

    it('refuses unknown operations and sub-sources', async () => {
        const bridge = createLxApiBridge({ sdk: fakeSdk(), request: () => ({}), manager: fakeManager(), log: {} });
        expect((await bridge.request('eval', {})).error.code).toBe('unsupported');
        expect((await bridge.request('lyric', { source: 'xm', musicInfo: {} })).error.code).toBe('unsupported');
    });
});

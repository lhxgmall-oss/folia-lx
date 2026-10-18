import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineProviderError } from '@/types/onlineMusic';
import { lxProvider } from '@/services/onlineMusic/lx/lxProvider';
import { normalizeLxSong } from '@/services/onlineMusic/lx/lxNormalize';
import { getLxListTracks, clearLxListCache } from '@/services/onlineMusic/lx/lxCatalog';
import { describeLxFailure } from '@/services/onlineMusic/lx/lxFailure';
import { LX_NEEDS_DESKTOP } from '@/services/onlineMusic/lx/lxTransport';

// test/unit/lx/lxProvider.test.ts
// The LX adapter against a fake desktop bridge: paging, audio, lyrics, song lists, failures.

const row = (n: number, source = 'kw') => ({ name: `song ${n}`, singer: 'S', source, songmid: String(n), interval: '03:00', img: null, types: [] });

const stubBridge = (handler: (operation: string, params: any) => unknown) => {
    const calls: Array<[string, any]> = [];
    vi.stubGlobal('window', {
        electron: {
            lxRequest: async (operation: string, params: any) => {
                calls.push([operation, params]);
                try {
                    return { ok: true, data: await handler(operation, params) };
                } catch (error: any) {
                    return { ok: false, error: { code: error.code || 'invalid-response', message: error.message } };
                }
            },
        },
    });
    return calls;
};

afterEach(() => {
    vi.unstubAllGlobals();
    clearLxListCache();
});

describe('lxProvider', () => {
    it('is unavailable outside the desktop app', () => {
        vi.stubGlobal('window', {});
        expect(lxProvider.getAvailability?.()).toEqual({ configured: false, reason: 'runtime-unavailable' });
    });

    it('asks for the page that the offset falls on', async () => {
        const calls = stubBridge(() => ({ list: [row(1), row(2), { bad: true }], total: 50, hasMore: true }));
        const page = await lxProvider.search!.searchSongs('晴天', 20, 40);
        expect(calls[0]).toEqual(['search', { query: '晴天', page: 3, limit: 20 }]);
        expect(page.items.map(song => song.id)).toEqual(['kw_1', 'kw_2']);
        expect(page).toMatchObject({ hasMore: true, nextOffset: 60, total: 50 });
    });

    it('hands the kept row to the script and reports the quality it got', async () => {
        const calls = stubBridge(() => ({ url: 'https://cdn/x.flac', quality: 'lossless', source: 'tx', fallbackFrom: 'kw' }));
        const song = normalizeLxSong(row(7));
        const source = await lxProvider.playback!.getAudioSource(song, 'hires');
        expect(calls[0][0]).toBe('music_url');
        expect(calls[0][1]).toMatchObject({ source: 'kw', quality: 'hires', musicInfo: { songmid: '7' } });
        expect(source).toMatchObject({ url: 'https://cdn/x.flac', quality: 'lossless' });
        expect(source!.expiresAt! - source!.fetchedAt).toBeGreaterThan(0);
    });

    it('turns a bridge error into an OnlineProviderError of LX', async () => {
        stubBridge(() => { throw Object.assign(new Error('No LX source script is imported or active'), { code: 'unavailable' }); });
        const error = await lxProvider.playback!.getAudioSource(normalizeLxSong(row(1)), 'high').catch(e => e);
        expect(error).toBeInstanceOf(OnlineProviderError);
        expect(error).toMatchObject({ code: 'unavailable', providerId: 'lx' });
        expect(describeLxFailure('audio', error)).toMatchObject({ case: 'not-configured' });
    });

    it('prefers the word-by-word track', async () => {
        stubBridge(() => ({
            lyric: '[00:01.00]hello world\n[00:03.00]next',
            tlyric: '[00:01.00]你好世界',
            rlyric: '',
            lxlyric: '[00:01.000]<0,500>hello <500,500>world\n[00:03.000]<0,800>next',
        }));
        const result = await lxProvider.lyrics!.getLyrics(normalizeLxSong(row(1)));
        expect(result.lyrics?.isWordByWord).toBe(true);
        expect(result.lyrics?.lines[0].fullText.trim()).toBe('hello world');
        expect(result.wordByWordText).toContain('<0,500>');
    });

    it('falls back to the plain LRC', async () => {
        stubBridge(() => ({ lyric: '[00:01.00]hello', tlyric: '', rlyric: '', lxlyric: '' }));
        const result = await lxProvider.lyrics!.getLyrics(normalizeLxSong(row(1)));
        expect(result.lyrics?.isWordByWord).toBe(false);
        expect(result.lyrics?.lines).toHaveLength(1);
    });

    it('reads a song list page by page and slices it', async () => {
        const calls = stubBridge((_operation, params) => ({
            list: params.page <= 2 ? Array.from({ length: 3 }, (_, i) => row((params.page - 1) * 3 + i)) : [],
            total: 6, page: params.page, limit: 3, info: { name: 'L' },
        }));
        const first = await getLxListTracks('kw__abc', 4, 0);
        expect(first.items.map(s => s.id)).toEqual(['kw_0', 'kw_1', 'kw_2', 'kw_3']);
        expect(first.hasMore).toBe(true);
        const second = await getLxListTracks('kw__abc', 4, 4);
        expect(second.items.map(s => s.id)).toEqual(['kw_4', 'kw_5']);
        expect(second.hasMore).toBe(false);
        expect(calls.filter(([op]) => op === 'songlist_detail')).toHaveLength(2);
    });

    it('recommends the hot lists of every sub-source in turn', async () => {
        stubBridge(operation => {
            if (operation === 'state') return { settings: { subSource: 'all' } };
            return { list: [{ id: '1', name: 'a', source: 'kw' }, { id: '2', name: 'b', source: 'kw' }] };
        });
        const lists = await lxProvider.recommendations!.getRecommendedCollections!(3);
        expect(lists).toHaveLength(3);
        expect(lists.every(list => list.providerId === 'lx')).toBe(true);
    });

    it('says the desktop app is needed', () => {
        expect(describeLxFailure('audio', new OnlineProviderError('unavailable', LX_NEEDS_DESKTOP, 'lx'))).toEqual({ case: 'not-configured' });
        expect(describeLxFailure('audio', new Error('x'))).toBeNull();
    });
});

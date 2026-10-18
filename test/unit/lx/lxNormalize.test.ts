import { describe, expect, it } from 'vitest';
import {
    lxArtists, lxCollectionTarget, lxIntervalMs, lxSongTarget, normalizeLxCollection, normalizeLxSong,
} from '@/services/onlineMusic/lx/lxNormalize';

// test/unit/lx/lxNormalize.test.ts
// LX musicSdk rows into Folia songs and collections, and back to what the bridge needs.

const kwRow = {
    name: '晴天', singer: '周杰伦、杨瑞代', source: 'kw', songmid: '228908', albumId: '1', albumName: '叶惠美',
    interval: '04:29', img: null, types: [{ type: '128k', size: '4.1M' }, { type: '320k', size: '10M' }],
    _types: { '128k': { size: '4.1M' } }, typeUrl: {}, lrc: null, otherSource: null, fn: undefined,
};

describe('normalizeLxSong', () => {
    it('keeps the row for the source script and names the song by sub-source and songmid', () => {
        const song = normalizeLxSong(kwRow);
        expect(song.id).toBe('kw_228908');
        expect(song.durationMs).toBe(269_000);
        expect(song.artists.map(a => a.name)).toEqual(['周杰伦', '杨瑞代']);
        expect(song.album).toEqual({ id: '1', name: '叶惠美', coverUrl: undefined });
        expect(song.sourceRef).toMatchObject({ kind: 'online', providerId: 'lx', mediaId: 'kw_228908' });
        const target = lxSongTarget(song);
        expect(target.source).toBe('kw');
        expect(target.musicInfo).toMatchObject({ songmid: '228908', types: kwRow.types });
        expect('fn' in target.musicInfo).toBe(false);
    });

    it('passes an already normalized song through and refuses rows without a source', () => {
        const song = normalizeLxSong(kwRow);
        expect(normalizeLxSong(song)).toBe(song);
        expect(() => normalizeLxSong({ ...kwRow, source: 'xm' })).toThrow();
        expect(() => normalizeLxSong({ ...kwRow, songmid: '' })).toThrow();
    });

    it('refuses a song of another provider', () => {
        expect(() => lxSongTarget({ sourceRef: { kind: 'online', providerId: 'qq' } })).toThrow();
    });
});

describe('helpers', () => {
    it('reads LX intervals', () => {
        expect(lxIntervalMs('03:05')).toBe(185_000);
        expect(lxIntervalMs('1:00:01')).toBe(3_601_000);
        expect(lxIntervalMs('--/--')).toBe(0);
        expect(lxIntervalMs(42)).toBe(42_000);
    });

    it('splits singers', () => {
        expect(lxArtists('A、B & C')).toHaveLength(3);
        expect(lxArtists('')).toEqual([]);
    });

    it('turns a song list row into a collection and back', () => {
        const collection = normalizeLxCollection({ id: 'digest-8__3700316563', name: 'x', img: 'http://i/1.jpg', total: '667', author: 'u', source: 'kw' });
        expect(collection).toMatchObject({ providerId: 'lx', id: 'kw__digest-8__3700316563', trackCount: 667, coverUrl: 'http://i/1.jpg' });
        expect(lxCollectionTarget(collection.id, collection)).toEqual({ source: 'kw', listId: 'digest-8__3700316563' });
        expect(lxCollectionTarget('tx__9758742632')).toEqual({ source: 'tx', listId: '9758742632' });
        expect(() => lxCollectionTarget('nope')).toThrow();
    });
});

import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeLxSong, lxSongTarget } from '@/services/onlineMusic/lx/lxNormalize';

// test/unit/lx/lxListFile.test.ts
// Reading lists exported from LX Music desktop (.lxmc = gzip JSON, or plain .json), turning LX's
// v2 music info back into the old shape the normalizer and the source script read, and keeping the
// lists (replacing a list imported again by its LX id).

const require = createRequire(import.meta.url);
const { parseLxListFile, v2ToOld } = require('../../../electron/lx/myLists/lxListFile.cjs');
const { createLxMyLists } = require('../../../electron/lx/myLists/lxMyLists.cjs');
const { createLxApiBridge } = require('../../../electron/lx/lxApiBridge.cjs');
const { createLxCoverFill } = require('../../../electron/lx/myLists/lxCoverFill.cjs');

// Shapes as LX desktop 2.x writes them (toNewMusicInfo / list export).
const v2Tx = {
    id: 'tx_003OUlho2HcRHC', name: '晴天', singer: '周杰伦', source: 'tx', interval: '04:29',
    meta: {
        songId: '003OUlho2HcRHC', albumName: '叶惠美', picUrl: 'https://y.gtimg.cn/a.jpg', albumId: '000MkMni19ClKG',
        qualitys: [{ type: '128k', size: '4.1M' }, { type: 'flac32bit', size: '60M' }],
        _qualitys: { '128k': true, flac32bit: true },
        strMediaMid: '003OUlho2HcRHC', albumMid: '000MkMni19ClKG', id: 97773,
    },
};
const v2Kg = {
    id: '1234_ABCDEF', name: '稻香', singer: '周杰伦', source: 'kg', interval: '03:43',
    meta: { songId: '1234', albumName: '魔杰座', picUrl: null, qualitys: [], _qualitys: {}, hash: 'ABCDEF', albumAudioId: '99' },
};
const v2Local = { id: 'local_x', name: 'x', singer: '', source: 'local', interval: null, meta: { songId: 'D:/x.mp3', filePath: 'D:/x.mp3', ext: 'mp3' } };
const v1Wy = {
    songmid: '186016', name: '晴天', singer: '周杰伦', source: 'wy', interval: '04:29', albumName: '叶惠美', albumId: '18905',
    img: 'http://p1.music.126.net/x.jpg', types: [{ type: '128k' }, { type: '320k' }], _types: { '128k': {}, '320k': {} }, typeUrl: {},
};
const v1Mg = { songmid: '600902000006889366', copyrightId: '60084600554', name: '七里香', singer: '周杰伦', source: 'mg', interval: '05:00', img: '', types: [], _types: {} };
const v1Local = { songmid: 'C:/a.flac', name: 'a', singer: 'b', source: 'local', filePath: 'C:/a.flac' };

const gz = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value)));
const plain = (value: unknown) => Buffer.from(JSON.stringify(value));

const dirs: string[] = [];
const store = () => {
    const dir = mkdtempSync(join(tmpdir(), 'lx-mylists-'));
    dirs.push(dir);
    return createLxMyLists({ baseDir: () => dir, now: () => 1000 });
};
afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('parseLxListFile', () => {
    it('reads a gzip playList_v2 export and turns v2 rows into the old shape', () => {
        const file = gz({
            type: 'playList_v2',
            data: [
                { id: 'default', name: 'list__name_default', list: [] },
                { id: 'love', name: 'list__name_love', list: [v2Tx, v2Local] },
                { id: 'userlist_1', name: '跑步', source: 'tx', sourceListId: '1', list: [v2Kg, v2Tx, v2Tx] },
            ],
        });
        const { type, lists } = parseLxListFile(file);
        expect(type).toBe('playList_v2');
        expect(lists.map((list: any) => [list.lxId, list.name, list.songs.length, list.skippedLocal])).toEqual([
            ['default', '试听列表', 0, 0],
            ['love', '我的收藏', 1, 1],
            ['userlist_1', '跑步', 2, 0],
        ]);
        const tx = lists[1].songs[0];
        expect(tx).toMatchObject({
            name: '晴天', singer: '周杰伦', source: 'tx', songmid: '003OUlho2HcRHC', interval: '04:29', albumName: '叶惠美',
            img: 'https://y.gtimg.cn/a.jpg', albumId: '000MkMni19ClKG', strMediaMid: '003OUlho2HcRHC', albumMid: '000MkMni19ClKG', songId: 97773,
        });
        // fixNewMusicInfoQuality: flac32bit is LX's old name of flac24bit.
        expect(tx.types.map((q: any) => q.type)).toEqual(['128k', 'flac24bit']);
        expect(tx._types).toEqual({ '128k': true, flac24bit: true });
        const kg = lists[2].songs[0];
        expect(kg).toMatchObject({ source: 'kg', songmid: '1234', hash: 'ABCDEF', albumAudioId: '99', img: '' });
    });

    it('reads a plain JSON v1 playList and keeps the old rows', () => {
        const { lists } = parseLxListFile(plain({ type: 'playList', data: [{ id: 'l1', name: '老列表', list: [v1Wy, v1Mg, v1Local] }] }));
        expect(lists).toHaveLength(1);
        expect(lists[0]).toMatchObject({ name: '老列表', skippedLocal: 1, skippedOther: 0 });
        expect(lists[0].songs[0]).toMatchObject({ songmid: '186016', source: 'wy', albumName: '叶惠美', img: 'http://p1.music.126.net/x.jpg' });
        expect(lists[0].songs[1]).toMatchObject({ songmid: '600902000006889366', copyrightId: '60084600554', source: 'mg' });
    });

    it('reads one list (playListPart_v2 and v1 playListPart)', () => {
        const v2 = parseLxListFile(gz({ type: 'playListPart_v2', data: { id: 'userlist_9', name: '单个', list: [v2Kg] } }));
        expect(v2.lists.map((list: any) => [list.lxId, list.name, list.songs.length])).toEqual([['userlist_9', '单个', 1]]);
        const v1 = parseLxListFile(plain({ type: 'playListPart', data: { id: 'userlist_8', name: '旧单个', list: [v1Wy] } }));
        expect(v1.lists[0].songs[0].songmid).toBe('186016');
    });

    it('takes the lists out of a full backup (allData_v2, allData) and ignores its settings', () => {
        const v2 = parseLxListFile(gz({ type: 'allData_v2', setting: { 'common.isAgreePact': true }, playList: [{ id: 'love', name: 'list__name_love', list: [v2Tx] }] }));
        expect(v2.lists[0]).toMatchObject({ lxId: 'love', name: '我的收藏' });
        const v1 = parseLxListFile(gz({ type: 'allData', setting: {}, playList: [{ id: 'u', name: 'U', list: [v1Wy] }] }));
        expect(v1.lists[0].songs).toHaveLength(1);
        const old = parseLxListFile(gz({ type: 'allData', setting: {}, defaultList: { list: [v1Wy] } }));
        expect(old.lists[0]).toMatchObject({ lxId: 'default', name: '试听列表' });
    });

    it('reads a file LX 1.14.0 serialized twice', () => {
        const { lists } = parseLxListFile(gz(JSON.stringify({ type: 'playListPart', data: { id: 'x', name: 'X', list: [v1Wy] } })));
        expect(lists[0].songs).toHaveLength(1);
    });

    it('counts local songs and unreadable rows and leaves them out', () => {
        const { lists } = parseLxListFile(plain({ type: 'playList_v2', data: [{ id: 'a', name: 'A', list: [v2Local, v2Local, { source: 'xx', name: 'n', meta: { songId: '1' } }, { ...v2Tx, meta: { ...v2Tx.meta, songId: '' } }, v2Tx] }] }));
        expect(lists[0]).toMatchObject({ skippedLocal: 2, skippedOther: 2 });
        expect(lists[0].songs).toHaveLength(1);
    });

    it('refuses what is not a list export', () => {
        expect(() => parseLxListFile(gz({ type: 'setting_v2', data: {} }))).toThrow(/settings file/);
        expect(() => parseLxListFile(plain({ type: 'other' }))).toThrow(/Not an LX Music list file/);
        expect(() => parseLxListFile(Buffer.from('not json'))).toThrow(/not JSON/);
        expect(() => parseLxListFile(Buffer.from([0x1f, 0x8b, 1, 2, 3]))).toThrow(/gzip/);
    });

    it('converts into exactly what the normalizer and the music URL request read', () => {
        const old = v2ToOld(v2Tx);
        const song = normalizeLxSong(old);
        expect(song.id).toBe('tx_003OUlho2HcRHC');
        expect(song.sourceRef).toMatchObject({ kind: 'online', providerId: 'lx', mediaId: 'tx_003OUlho2HcRHC' });
        expect(song.album).toMatchObject({ name: '叶惠美', coverUrl: 'https://y.gtimg.cn/a.jpg' });
        expect(song.durationMs).toBe(269_000);
        const target = lxSongTarget(song);
        expect(target.source).toBe('tx');
        expect(target.musicInfo).toMatchObject({ songmid: '003OUlho2HcRHC', strMediaMid: '003OUlho2HcRHC', types: [{ type: '128k' }, { type: 'flac24bit' }] });
    });
});

describe('createLxMyLists', () => {
    it('keeps imported lists, pages their songs, and replaces a list imported again by its LX id', () => {
        const lists = store();
        const first = lists.importLists(parseLxListFile(gz({ type: 'playList_v2', data: [
            { id: 'default', name: 'list__name_default', list: [v2Local] },
            { id: 'userlist_1', name: '跑步', list: [v2Kg, v2Tx] },
        ] })));
        expect(first).toEqual({ lists: 1, songs: 2, updated: 0, skippedLocal: 1, skippedOther: 0, emptyLists: 1 });
        const [kept] = lists.list();
        expect(kept).toMatchObject({ lxId: 'userlist_1', name: '跑步', count: 2, cover: 'https://y.gtimg.cn/a.jpg' });
        expect(lists.tracks({ key: kept.key, offset: 1, limit: 5 })).toMatchObject({ total: 2, list: [{ songmid: '003OUlho2HcRHC' }] });

        const again = lists.importLists(parseLxListFile(gz({ type: 'playListPart_v2', data: { id: 'userlist_1', name: '跑步（新）', list: [v2Tx] } })));
        expect(again).toMatchObject({ lists: 1, songs: 1, updated: 1 });
        expect(lists.list()).toHaveLength(1);
        expect(lists.list()[0]).toMatchObject({ key: kept.key, name: '跑步（新）', count: 1 });
        expect(lists.tracks({ key: kept.key }).list.map((row: any) => row.songmid)).toEqual(['003OUlho2HcRHC']);

        expect(lists.remove(kept.key)).toBe(true);
        expect(lists.list()).toEqual([]);
        expect(lists.tracks({ key: kept.key })).toEqual({ list: [], total: 0 });
        expect(lists.tracks({ key: '../index' })).toEqual({ list: [], total: 0 });
    });

    it('is reached through the bridge, with the file the picker hands over', async () => {
        const myLists = store();
        let file: Buffer | null = gz({ type: 'playList', data: [{ id: 'l', name: 'L', list: [v1Wy, v1Local] }] });
        const bridge = createLxApiBridge({
            sdk: { sources: {}, setRequester() {} }, request: null, manager: {}, myLists, log: { info() {} },
            pickListFile: async () => file,
        });
        const imported = await bridge.request('mylist_import_file');
        expect(imported).toEqual({ ok: true, data: { lists: 1, songs: 1, updated: 0, skippedLocal: 1, skippedOther: 0, emptyLists: 0, type: 'playList' } });
        const listed = await bridge.request('mylists');
        expect(listed.data).toHaveLength(1);
        const tracks = await bridge.request('mylist_tracks', { key: listed.data[0].key });
        expect(tracks.data.list[0].songmid).toBe('186016');
        file = null;
        expect(await bridge.request('mylist_import_file')).toEqual({ ok: true, data: null });
        file = plain({ type: 'setting_v2' });
        expect(await bridge.request('mylist_import_file')).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
    });
});

describe('createLxCoverFill', () => {
    const quiet = { info() {}, warn() {} };

    it('asks getPic, a few at a time, for each song without a cover and keeps what it gets', async () => {
        const lists = store();
        const noCover = (n: number, source = 'kw') => ({ songmid: `m${n}`, name: `s${n}`, singer: 'S', source, interval: '03:00', img: '', types: [], _types: {} });
        lists.importLists(parseLxListFile(plain({ type: 'playList', data: [
            { id: 'a', name: 'A', list: [noCover(1), noCover(2), { ...v1Wy }, noCover(3, 'kg'), noCover(4)] },
            { id: 'b', name: 'B', list: [noCover(1), noCover(5)] },
        ] })));
        let inFlight = 0;
        let most = 0;
        const asked: string[] = [];
        const fill = createLxCoverFill({
            myLists: lists,
            concurrency: 3,
            log: quiet,
            getPic: async (row: any) => {
                asked.push(`${row.source}_${row.songmid}`);
                inFlight += 1;
                most = Math.max(most, inFlight);
                await new Promise(resolve => setTimeout(resolve, 5));
                inFlight -= 1;
                if (row.songmid === 'm4') throw new Error('no cover');
                if (row.songmid === 'm5') return null;
                return `https://pic/${row.songmid}.jpg`;
            },
        });
        await fill.start();
        // The song with a cover (wy) is not asked; m1, in both lists, is asked once.
        expect(asked.sort()).toEqual(['kg_m3', 'kw_m1', 'kw_m2', 'kw_m4', 'kw_m5']);
        expect(most).toBeLessThanOrEqual(3);
        expect(fill.status()).toEqual({ running: false, done: 5, total: 5, filled: 3 });
        const [a, b] = lists.list();
        expect(lists.songsOf(a.key).map((row: any) => row.img)).toEqual([
            'https://pic/m1.jpg', 'https://pic/m2.jpg', 'http://p1.music.126.net/x.jpg', 'https://pic/m3.jpg', '',
        ]);
        expect(lists.songsOf(b.key).map((row: any) => row.img)).toEqual(['https://pic/m1.jpg', '']);
        // The list's cover is its first song's.
        expect(a.cover).toBe('https://pic/m1.jpg');
        expect(b.cover).toBe('https://pic/m1.jpg');
        // A failed song is not asked again in this run.
        asked.length = 0;
        await fill.start();
        expect(asked).toEqual([]);
    });

    it('does not undo a list imported again while covers were being asked for', async () => {
        const lists = store();
        lists.importLists(parseLxListFile(plain({ type: 'playListPart', data: { id: 'a', name: 'A', list: [{ songmid: 'm1', name: 'x', source: 'kw', img: '' }] } })));
        const fill = createLxCoverFill({
            myLists: lists,
            log: quiet,
            getPic: async () => {
                lists.importLists(parseLxListFile(plain({ type: 'playListPart', data: { id: 'a', name: 'A2', list: [{ songmid: 'm1', name: 'x', source: 'kw', img: '' }, { songmid: 'm9', name: 'y', source: 'kw', img: 'https://own' }] } })));
                return 'https://pic/m1.jpg';
            },
        });
        await fill.start();
        const [a] = lists.list();
        expect(a.name).toBe('A2');
        expect(lists.songsOf(a.key).map((row: any) => row.img)).toEqual(['https://pic/m1.jpg', 'https://own']);
    });

    it('runs after an import through the bridge without holding the import up, and says how far it is', async () => {
        const myLists = store();
        let release: () => void = () => {};
        const gate = new Promise<void>(resolve => { release = resolve; });
        const sdk = { setRequester() {}, sources: { wy: { getPic: async () => { await gate; return 'https://pic/wy.jpg'; } } } };
        const bridge = createLxApiBridge({
            sdk, request: null, manager: {}, myLists, log: quiet,
            pickListFile: async () => plain({ type: 'playList', data: [{ id: 'l', name: 'L', list: [{ ...v1Wy, img: '' }] }] }),
        });
        const imported = await bridge.request('mylist_import_file');
        expect(imported.data).toMatchObject({ lists: 1, songs: 1 });
        expect((await bridge.request('mylist_cover_status')).data).toMatchObject({ running: true, total: 1, done: 0 });
        release();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect((await bridge.request('mylist_cover_status')).data).toEqual({ running: false, done: 1, total: 1, filled: 1 });
        const [list] = (await bridge.request('mylists')).data;
        expect(list.cover).toBe('https://pic/wy.jpg');
        expect((await bridge.request('mylist_tracks', { key: list.key })).data.list[0].img).toBe('https://pic/wy.jpg');
    });
});

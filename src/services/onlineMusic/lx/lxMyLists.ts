import type { UnifiedSong } from '../../../types';
import type { ProviderCollection, ProviderPage, ProviderUser } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { lxPage, normalizeLxSong } from './lxNormalize';
import type { LxMusicInfo } from './lxNormalize';
import { requestLx } from './lxTransport';

// src/services/onlineMusic/lx/lxMyLists.ts
// The lists imported from LX Music desktop's 「我的列表」 (an exported .lxmc / .json file), kept by the
// main process (electron/lx/myLists/). Folia's local playlists hold only songs of the local library,
// so these lists are the LX provider's own library: the provider has one local "account" that is
// always there (LX_LOCAL_USER, lxProvider.ts `auth`) and these lists are its playlists, shown on the
// home screen's 歌单 tab and opened like any online playlist. Their songs are LX songs
// (providerId 'lx'), played through the imported custom source script.

export interface LxMyListInfo {
    key: string;
    lxId: string;
    name: string;
    count: number;
    cover: string;
    importedAt: number;
    updatedAt: number;
}

export interface LxListImportResult {
    lists: number;
    songs: number;
    updated: number;
    skippedLocal: number;
    skippedOther: number;
    emptyLists: number;
    type: string;
}

/** The one "account" of the LX provider: nobody signs in, the imported lists are its library. */
export const LX_LOCAL_USER: ProviderUser = { id: 'lx-local', nickname: 'LX Music' };

const MY_LIST_PREFIX = 'lxmy__';
const PAGE = 500;

export const lxMyListCollectionId = (key: string) => `${MY_LIST_PREFIX}${key}`;

/** The key of an imported list from its collection or id; null for any other LX list. */
export const lxMyListKey = (id: unknown, collection?: ProviderCollection): string | null => {
    const fromData = collection?.providerData?.lxMyList;
    if (typeof fromData === 'string' && fromData) return fromData;
    const text = String(id ?? '');
    return text.startsWith(MY_LIST_PREFIX) ? text.slice(MY_LIST_PREFIX.length) : null;
};

export const normalizeLxMyList = (info: LxMyListInfo): ProviderCollection => ({
    providerId: 'lx',
    id: lxMyListCollectionId(info.key),
    type: 'playlist',
    name: info.name,
    coverUrl: info.cover || undefined,
    trackCount: info.count,
    isOwned: true,
    creator: LX_LOCAL_USER,
    updatedAt: info.updatedAt,
    providerData: { lxMyList: info.key, lxId: info.lxId },
});

export const readLxMyLists = async (): Promise<LxMyListInfo[]> => {
    const lists = await requestLx<LxMyListInfo[]>('mylists');
    if (!Array.isArray(lists)) throw new OnlineProviderError('invalid-response', 'LX lists are missing', 'lx');
    return lists;
};

/** Opens the file picker in the main process; null when the listener cancels. */
export const importLxListFile = () => requestLx<LxListImportResult | null>('mylist_import_file');
export interface LxCoverFillStatus { running: boolean; done: number; total: number; filled: number }
/** How far the background fill of the imported songs' covers has come (electron/lx/myLists/lxCoverFill.cjs). */
export const readLxCoverFillStatus = () => requestLx<LxCoverFillStatus>('mylist_cover_status');
export const removeLxMyList = (key: string) => requestLx<boolean>('mylist_remove', { key });

// The songs of a list read so far (one list at a time is open; reading from disk is cheap anyway).
const cache = new Map<string, { songs: UnifiedSong[]; total: number }>();

const readSongs = async (key: string) => {
    const songs: UnifiedSong[] = [];
    let offset = 0;
    let total = 0;
    for (;;) {
        const page = await requestLx<{ list: LxMusicInfo[]; total: number }>('mylist_tracks', { key, offset, limit: PAGE });
        const rows = Array.isArray(page?.list) ? page.list : [];
        total = Number(page?.total) || 0;
        for (const row of rows) {
            try { songs.push(normalizeLxSong(row)); } catch { /* a row the normalizer cannot read is left out */ }
        }
        offset += rows.length;
        if (!rows.length || offset >= total) break;
    }
    return { songs, total: songs.length };
};

export async function getLxMyListTracks(key: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> {
    // A read from the start reads the list again: it may have been imported anew meanwhile.
    let entry = offset > 0 ? cache.get(key) : undefined;
    if (!entry) {
        entry = await readSongs(key);
        cache.clear();
        cache.set(key, entry);
    }
    const items = entry.songs.slice(offset, offset + limit);
    return lxPage(items, offset, offset + items.length < entry.songs.length, entry.total);
}

export async function getLxMyListDetail(key: string, collection?: ProviderCollection): Promise<ProviderCollection | null> {
    const info = (await readLxMyLists()).find(list => list.key === key);
    if (!info) return collection ?? null;
    return normalizeLxMyList(info);
}

export const clearLxMyListCache = () => cache.clear();

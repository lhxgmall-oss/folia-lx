import type { UnifiedSong } from '../../../types';
import type { OnlineCatalogProvider, ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { lxCollectionTarget, lxPage, normalizeLxCollection, normalizeLxSong } from './lxNormalize';
import type { LxMusicInfo, LxSubSource } from './lxNormalize';
import { requestLx } from './lxTransport';

// src/services/onlineMusic/lx/lxCatalog.ts
// Song lists of the five LX sub-sources. LX reads a list in pages of the platform's own size; Folia asks
// by offset and limit, so the pages read so far are kept per list (in memory, a few lists) and sliced.

type ListDetail = { list: LxMusicInfo[]; total: number; page: number; limit: number; info?: Record<string, unknown> };
type ListCache = { songs: UnifiedSong[]; total: number; nextPage: number; done: boolean; info?: Record<string, unknown> };

const MAX_CACHED_LISTS = 8;
const MAX_PAGES_PER_READ = 20;
const cache = new Map<string, ListCache>();

const cacheFor = (key: string): ListCache => {
    let entry = cache.get(key);
    if (entry) {
        cache.delete(key);
        cache.set(key, entry);
        return entry;
    }
    entry = { songs: [], total: 0, nextPage: 1, done: false };
    cache.set(key, entry);
    while (cache.size > MAX_CACHED_LISTS) cache.delete(cache.keys().next().value as string);
    return entry;
};

const readPage = async (entry: ListCache, source: LxSubSource, listId: string) => {
    const detail = await requestLx<ListDetail>('songlist_detail', { source, id: listId, page: entry.nextPage });
    const rows = Array.isArray(detail.list) ? detail.list : [];
    const songs = rows.flatMap(row => {
        try { return [normalizeLxSong(row)]; } catch { return []; }
    });
    entry.songs.push(...songs);
    entry.total = Number(detail.total) || entry.songs.length;
    entry.info = detail.info || entry.info;
    entry.nextPage += 1;
    // Some sources answer the whole list at once, some page; an empty or short page ends it.
    entry.done = rows.length === 0 || entry.songs.length >= entry.total || (detail.limit > 0 && rows.length < detail.limit);
};

export async function getLxListTracks(id: unknown, limit: number, offset: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>> {
    const { source, listId } = lxCollectionTarget(id, collection);
    const entry = cacheFor(`${source}__${listId}`);
    let reads = 0;
    while (!entry.done && entry.songs.length < offset + limit && reads < MAX_PAGES_PER_READ) {
        await readPage(entry, source, listId);
        reads += 1;
    }
    const items = entry.songs.slice(offset, offset + limit);
    return lxPage(items, offset, !entry.done || offset + items.length < entry.songs.length, entry.total || undefined);
}

export const lxCatalog: OnlineCatalogProvider = {
    canResolveSongCatalogRefs: song => song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'lx',
    resolveSongCatalogRefs: async song => song,
    getPlaylistTracks: (id, limit, offset, collection) => getLxListTracks(id, limit, offset, collection),
    async getPlaylistDetail(id, collection) {
        const { source, listId } = lxCollectionTarget(id, collection);
        const entry = cacheFor(`${source}__${listId}`);
        if (!entry.info && !entry.done) await readPage(entry, source, listId);
        const info = (entry.info || {}) as Record<string, unknown>;
        const base = collection ?? normalizeLxCollection({ source, id: listId, name: info.name || listId });
        return {
            ...base,
            name: String(info.name || base.name || listId),
            coverUrl: String(info.img || base.coverUrl || '') || undefined,
            description: String(info.desc || base.description || ''),
            trackCount: entry.total || base.trackCount,
        };
    },
};

/** Forgets the lists read so far (a fresh read of a list asks the platform again). */
export const clearLxListCache = () => cache.clear();

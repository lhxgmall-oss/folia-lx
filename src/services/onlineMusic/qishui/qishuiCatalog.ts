import type { OnlineCatalogProvider, OnlineLibraryProvider, ProviderPage } from '../../../types/onlineMusic';
import { normalizeQishuiCollection, normalizeQishuiSong, type QishuiRecord } from './qishuiNormalize';
import { requestQishui } from './qishuiTransport';

// Catalogue and account collection reads; paging metadata is supplied by the car bridge.
export const qishuiCatalog: OnlineCatalogProvider = {
    async getPlaylistTracks(id, limit, offset, collection) {
        const page = await requestQishui<ProviderPage<unknown>>('playlist_tracks', { id: String(id), limit, offset,
            ownerId: typeof collection?.providerData?.ownerId === 'string' ? collection.providerData.ownerId : '' });
        return { ...page, items: page.items.map(normalizeQishuiSong) };
    },
    async getPlaylistDetail(id, collection) {
        const raw = await requestQishui('playlist_detail', { id: String(id), limit: 1,
            ownerId: typeof collection?.providerData?.ownerId === 'string' ? collection.providerData.ownerId : '' });
        return raw ? normalizeQishuiCollection(raw) : null;
    },
    async getArtistSongs(id, limit, offset) {
        const page = await requestQishui<ProviderPage<unknown>>('artist_songs', { id: String(id), limit, offset });
        return { ...page, items: page.items.map(normalizeQishuiSong) };
    },
    async getArtistDetail(id) {
        const raw = await requestQishui('artist_detail', { id: String(id) });
        return raw ? normalizeQishuiCollection(raw, 'artist') : null;
    },
};
export const qishuiLibrary: OnlineLibraryProvider = {
    async getUserPlaylists(_userId, limit, offset) {
        const page = await requestQishui<ProviderPage<QishuiRecord>>('user_playlists', { limit, offset });
        return { ...page, items: page.items.map(item => normalizeQishuiCollection(item)) };
    },
};

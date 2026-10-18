import type { Artist, UnifiedSong } from '../../../types';
import type { JsonValue, ProviderCollection, ProviderPage } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';

// src/services/onlineMusic/lx/lxNormalize.ts
// LX musicSdk rows (the "old" music info shape lx-music-desktop hands a source script: name, singer,
// source, songmid, albumId, albumName, interval, img, types, _types, hash, ...) into Folia's songs and
// collections. The row itself rides along in providerData.musicInfo: the source script reads it back.

export const LX_SUB_SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg'] as const;
export type LxSubSource = typeof LX_SUB_SOURCES[number];
export const isLxSubSource = (value: unknown): value is LxSubSource => (LX_SUB_SOURCES as readonly unknown[]).includes(value);

export type LxMusicInfo = Record<string, any>;
const text = (value: unknown) => (value == null ? '' : String(value));

/** 'mm:ss' or 'h:mm:ss' to milliseconds; LX writes '--/--' for an unknown length. */
export const lxIntervalMs = (interval: unknown): number => {
    if (typeof interval === 'number' && Number.isFinite(interval)) return Math.max(0, interval) * 1000;
    const parts = text(interval).split(':').map(part => Number.parseInt(part, 10));
    if (!parts.length || parts.some(part => !Number.isFinite(part))) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
};

/** LX joins several singers with 、 (and some sources with / or &). */
export const lxArtists = (singer: unknown): Artist[] => text(singer)
    .split(/、|\s\/\s|&/)
    .map(name => name.trim())
    .filter(Boolean)
    .map(name => ({ id: name, name }));

// Strips what a JSON store cannot keep (undefined, functions) from the row.
const toJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue;

export const lxMediaId = (source: string, songmid: unknown) => `${source}_${text(songmid)}`;

export const normalizeLxSong = (raw: unknown): UnifiedSong => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as LxMusicInfo;
    if (item.sourceRef?.kind === 'online' && item.sourceRef.providerId === 'lx') return item as UnifiedSong;
    if (!isLxSubSource(item.source) || item.songmid == null || item.songmid === '') {
        throw new OnlineProviderError('invalid-response', 'LX song has no source or songmid', 'lx');
    }
    const id = lxMediaId(item.source, item.songmid);
    return {
        id,
        name: text(item.name),
        artists: lxArtists(item.singer),
        album: { id: text(item.albumId), name: text(item.albumName), coverUrl: text(item.img) || undefined },
        durationMs: lxIntervalMs(item.interval),
        sourceRef: {
            kind: 'online',
            providerId: 'lx',
            mediaId: id,
            providerData: { lxSource: item.source, musicInfo: toJson(item) },
        },
    };
};

/** The sub-source and LX row of one of our songs, for the bridge. */
export const lxSongTarget = (song: { sourceRef?: { kind: string; providerId?: string; providerData?: Record<string, JsonValue> } }) => {
    const ref = song.sourceRef;
    if (ref?.kind !== 'online' || ref.providerId !== 'lx') {
        throw new OnlineProviderError('unsupported', 'Song does not belong to LX', 'lx');
    }
    const source = ref.providerData?.lxSource;
    const musicInfo = ref.providerData?.musicInfo;
    if (!isLxSubSource(source) || !musicInfo || typeof musicInfo !== 'object') {
        throw new OnlineProviderError('invalid-response', 'LX song lost its music info', 'lx');
    }
    return { source, musicInfo: musicInfo as LxMusicInfo };
};

// A song list row (songList.getList / search): { id, name, img, author, total, desc, play_count, source }.
export const normalizeLxCollection = (raw: unknown): ProviderCollection => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as LxMusicInfo;
    if (item.providerId === 'lx') return item as ProviderCollection;
    if (!isLxSubSource(item.source) || item.id == null || item.id === '') {
        throw new OnlineProviderError('invalid-response', 'LX song list has no source or id', 'lx');
    }
    const total = Number(item.total);
    return {
        providerId: 'lx',
        id: `${item.source}__${text(item.id)}`,
        type: 'playlist',
        name: text(item.name),
        coverUrl: text(item.img) || undefined,
        description: text(item.desc),
        ...(Number.isFinite(total) && total > 0 ? { trackCount: total } : {}),
        ...(item.author ? { creator: { id: text(item.author), nickname: text(item.author) } } : {}),
        providerData: { lxSource: item.source, listId: text(item.id) },
    };
};

/** Sub-source and list id from one of our song lists, or from its id alone. */
export const lxCollectionTarget = (id: unknown, collection?: ProviderCollection) => {
    const data = collection?.providerData;
    if (data && isLxSubSource(data.lxSource) && typeof data.listId === 'string') return { source: data.lxSource, listId: data.listId };
    const match = /^(kw|kg|tx|wy|mg)__(.+)$/.exec(text(id));
    if (!match) throw new OnlineProviderError('invalid-response', 'Not an LX song list id', 'lx');
    return { source: match[1] as LxSubSource, listId: match[2] };
};

export const lxPage = <T>(items: T[], offset: number, hasMore: boolean, total?: number): ProviderPage<T> => ({
    items,
    ...(typeof total === 'number' && Number.isFinite(total) && total >= 0 ? { total } : {}),
    hasMore,
    nextOffset: offset + items.length,
});

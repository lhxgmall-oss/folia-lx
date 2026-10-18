import type { AudioQualityPreference, OnlineMusicProvider, ProviderCollection } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { parseAwlrc, parseLRC } from '../../../utils/lyrics/parserCore';
import { isPureMusicLyricText } from '../../../utils/lyrics/pureMusic';
import { getLxTransportAvailability, requestLx } from './lxTransport';
import { describeLxFailure } from './lxFailure';
import { LX_SUB_SOURCES, lxSongTarget, normalizeLxCollection, normalizeLxSong } from './lxNormalize';
import type { LxMusicInfo } from './lxNormalize';
import { lxCatalog } from './lxCatalog';
import { LX_LOCAL_USER, normalizeLxMyList, readLxMyLists } from './lxMyLists';

// src/services/onlineMusic/lx/lxProvider.ts
// LX Music (洛雪音乐) as an Omni provider, desktop only. Search, song lists, lyrics and covers come from
// the LX musicSdk ported into the main process (electron/lx/musicSdk); the audio URL of a song comes from
// the custom source script the listener imported in settings (no script ships with Folia-LX). Search is
// over one sub-source (kw/kg/tx/wy/mg) or all of them, as set in settings; where the script fails for
// a song, the bridge looks for the same song on another sub-source.
//
// Nobody signs in to LX. The provider still has one local "account" (LX_LOCAL_USER, always signed in)
// so that the lists imported from LX Music desktop's 「我的列表」 (lxMyLists.ts) show as its library
// on the home screen's 歌单 tab the way any platform's playlists do; the 电台 tab shows the hot lists.

type SearchAnswer = { list: LxMusicInfo[]; total: number; hasMore: boolean };
type MusicUrlAnswer = { url: string; quality: AudioQualityPreference; source: string; fallbackFrom?: string };
type LyricAnswer = { lyric: string; tlyric: string; rlyric: string; lxlyric: string };
type HotListAnswer = { list: unknown[] };

// How long a URL from a source script is used before asking again. Scripts do not say; platform
// URLs they hand out commonly last from tens of minutes to a few hours.
const AUDIO_URL_TTL_MS = 20 * 60 * 1000;
const LEVELS: readonly AudioQualityPreference[] = ['standard', 'high', 'lossless', 'hires'];

const normalizeRows = (rows: unknown[]) => rows.flatMap(row => {
    try { return [normalizeLxSong(row)]; } catch { return []; }
});

const interleave = <T>(lists: T[][]): T[] => {
    const out: T[] = [];
    const longest = Math.max(0, ...lists.map(list => list.length));
    for (let index = 0; index < longest; index += 1) {
        for (const list of lists) if (index < list.length) out.push(list[index]);
    }
    return out;
};

export const lxProvider: OnlineMusicProvider = {
    id: 'lx', displayName: 'LX Music 聚合', shortName: 'LX',
    mark: { letter: '洛', color: '#4f46e5' },
    getAvailability: getLxTransportAvailability,
    describeFailure: describeLxFailure,
    capabilities: {
        search: true, playback: true, lyrics: true, wordByWordLyrics: true, auth: true,
        userLibrary: true, playlists: true, albums: false, artists: false, recommendations: true, mutations: false,
    },
    normalizeSong: normalizeLxSong,
    // The local "account" of the imported lists: always there, nothing to sign in to or out of.
    auth: {
        getLoginStatus: async () => LX_LOCAL_USER,
        logout: async () => {},
        showsKeptAccountAtStart: true,
    },
    library: {
        async getUserPlaylists(_userId, limit, offset) {
            const lists = (await readLxMyLists()).map(normalizeLxMyList);
            const items = lists.slice(offset, offset + limit);
            return { items, total: lists.length, hasMore: offset + items.length < lists.length, nextOffset: offset + items.length };
        },
    },
    normalizeCollection: raw => normalizeLxCollection(raw),
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: {
        // Folia asks by offset; LX by page. Pages are `limit` long, so offset / limit is the page.
        async searchSongs(query, limit, offset) {
            const page = Math.floor(Math.max(0, offset) / Math.max(1, limit)) + 1;
            if (!query.trim()) return { items: [], total: 0, hasMore: false, nextOffset: offset };
            const data = await requestLx<SearchAnswer>('search', { query, page, limit });
            if (!Array.isArray(data.list)) throw new OnlineProviderError('invalid-response', 'LX search list is missing', 'lx');
            const items = normalizeRows(data.list);
            return { items, total: Number(data.total) || undefined, hasMore: Boolean(data.hasMore) && items.length > 0, nextOffset: offset + limit };
        },
    },
    playback: {
        audioQualityLevels: LEVELS,
        // A song cannot be found again from its id alone: what plays it is the row kept with it.
        async getSongDetail() { return null; },
        async getAudioSource(song, quality) {
            const { source, musicInfo } = lxSongTarget(song);
            const data = await requestLx<MusicUrlAnswer>('music_url', { source, musicInfo, quality });
            if (!data?.url) return null;
            if (data.fallbackFrom) console.info(`[LX] audio from ${data.source} instead of ${data.fallbackFrom}`);
            const fetchedAt = Date.now();
            return { url: data.url, fetchedAt, expiresAt: fetchedAt + AUDIO_URL_TTL_MS, quality: LEVELS.includes(data.quality) ? data.quality : quality };
        },
        getAvailability() { return { state: 'unknown' }; },
    },
    lyrics: {
        async getLyrics(song) {
            const { source, musicInfo } = lxSongTarget(song);
            const data = await requestLx<LyricAnswer>('lyric', { source, musicInfo });
            const mainText = data.lyric || '';
            // `lxlyric` is LX's word-by-word track ([mm:ss.ms]<offset,duration>word), the same text the
            // awlrc container carries; where a sub-source has none, the plain LRC is used.
            const wordLyrics = data.lxlyric ? parseAwlrc(data.lxlyric, data.tlyric || '', {}, data.rlyric || '') : null;
            const lyrics = wordLyrics?.lines.length
                ? wordLyrics
                : mainText ? parseLRC(mainText, data.tlyric || '', {}, data.rlyric || '') : null;
            return {
                lyrics: lyrics?.lines.length ? lyrics : null,
                mainText,
                wordByWordText: wordLyrics?.lines.length ? data.lxlyric : null,
                translationText: data.tlyric || null,
                romanizationText: data.rlyric || null,
                isPureMusic: isPureMusicLyricText(mainText),
            };
        },
    },
    catalog: lxCatalog,
    recommendations: {
        // The hot song lists of the sub-source chosen in settings, or of every sub-source in turn.
        async getRecommendedCollections(limit) {
            const settings = (await requestLx<{ settings: { subSource: string } }>('state')).settings;
            const sources = settings.subSource === 'all' ? [...LX_SUB_SOURCES] : [settings.subSource];
            const settled = await Promise.allSettled(sources.map(source => requestLx<HotListAnswer>('songlist_hot', { source, page: 1 })));
            const lists = settled.map(result => (result.status === 'fulfilled' && Array.isArray(result.value.list)
                ? result.value.list.flatMap(row => {
                    try { return [normalizeLxCollection(row)]; } catch { return []; }
                }) : [] as ProviderCollection[]));
            if (settled.every(result => result.status === 'rejected')) {
                throw (settled[0] as PromiseRejectedResult).reason;
            }
            return interleave(lists).slice(0, limit);
        },
    },
};

import type { OnlineMusicProvider, ProviderAudioSource, ProviderPage, LoginState } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { requestQishui, getQishuiAvailability, getQishuiLastFailure, QishuiRequestError } from './qishuiTransport';
import { normalizeQishuiSong, normalizeQishuiUser, normalizeQishuiCollection } from './qishuiNormalize';
import { qishuiCatalog, qishuiLibrary } from './qishuiCatalog';
import { parseQishuiLyrics } from './qishuiLyrics';
import { diagnosticLine } from '../login/loginDiagnosticReport';
import { qishuiExplore, clearQishuiExplore } from './qishuiExplore';
import { qishuiRecommendations, clearQishuiRecommendations } from './qishuiRecommendations';

// Car platform adapter; only verified car abilities are advertised to the Omni UI.
const songId = (song: Parameters<typeof getPlaybackSourceRef>[0]) => {
    const source = getPlaybackSourceRef(song);
    if (source.kind !== 'online' || source.providerId !== 'qishui') throw new OnlineProviderError('unsupported', 'Song does not belong to Qishui', 'qishui');
    return source.mediaId;
};
export const qishuiProvider: OnlineMusicProvider = {
    id: 'qishui', displayName: '汽水音乐', shortName: '汽水', mark: { letter: '汽', color: '#19a58c' },
    getAvailability: getQishuiAvailability,
    capabilities: { search: true, playback: true, lyrics: true, wordByWordLyrics: true, auth: true,
        userLibrary: true, playlists: true, albums: false, artists: true, recommendations: true,
        mutations: false, likes: false, explore: true, personalFmModes: true },
    normalizeSong: normalizeQishuiSong, normalizeUser: normalizeQishuiUser, normalizeCollection: normalizeQishuiCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    getSongPageUrl: song => `https://music.douyin.com/qishui/share/track?track_id=${encodeURIComponent(songId(song))}`,
    search: {
        async searchSongs(query, limit, offset) {
            if (!query.trim()) return { items: [], hasMore: false, nextOffset: offset };
            const page = await requestQishui<ProviderPage<unknown>>('search', { query, limit, offset });
            return { ...page, items: page.items.map(normalizeQishuiSong) };
        },
    },
    playback: {
        audioQualityLevels: ['standard'],
        async getSongDetail(id) { return normalizeQishuiSong(await requestQishui('song_detail', { id: String(id) })); },
        getAudioSource: (song, quality) => requestQishui<ProviderAudioSource>('audio', { id: songId(song), quality }),
        getAvailability: () => ({ state: 'unknown' }),
    },
    lyrics: { getLyrics: async song => parseQishuiLyrics(await requestQishui('lyrics', { id: songId(song) })) },
    auth: {
        describeLoginFailure(_step, error) {
            if (error instanceof OnlineProviderError && error.code === 'network') return { case: 'unreachable' };
            if (!(error instanceof QishuiRequestError)) return null;
            return { ...(error.stage === 'account' ? { case: 'account-not-read' as const } : {}),
                ...(error.upstreamCode ? { code: error.upstreamCode } : {}), mainCode: error.stage || undefined };
        },
        async getLoginDiagnostics() {
            const failure = getQishuiLastFailure();
            return failure ? [diagnosticLine`stage=${failure.stage} code=${failure.code} upstreamCode=${failure.upstreamCode}`] : [];
        },
        getLoginTexts: () => ({ title: 'home.loginTitleQishui', note: 'home.loginNoteQishui' }),
        async getLoginStatus() { const user = await requestQishui('login_status'); return user ? normalizeQishuiUser(user) : null; },
        async startLogin() { return (await requestQishui<{ key: string }>('login_qr_key')).key; },
        async createQr(key) { return (await requestQishui<{ imageUrl: string }>('login_qr_create', { key })).imageUrl; },
        async checkLogin(key) {
            try {
                const result = await requestQishui<LoginState>('login_qr_check', { key });
                if (result.state === 'confirmed') { clearQishuiExplore(); clearQishuiRecommendations(); }
                return result;
            } catch (error) {
                if (error instanceof OnlineProviderError && error.code === 'network') return { state: 'error', transient: true, failure: { case: 'unreachable' } };
                throw error;
            }
        },
        async cancelLogin(key) { await requestQishui('login_qr_cancel', { key }); },
        getLoginTtlMs: () => 300000,
        async logout() { clearQishuiExplore(); clearQishuiRecommendations(); await requestQishui('logout'); },
    },
    catalog: qishuiCatalog, library: qishuiLibrary, explore: qishuiExplore,
    recommendations: qishuiRecommendations,
};

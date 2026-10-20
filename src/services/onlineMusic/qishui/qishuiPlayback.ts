import type { QishuiTrackCheck } from 'qishui-music-api';
import type { OnlinePlaybackProvider, ProviderAudioSource, ProviderSongAvailability } from '../../../types/onlineMusic';
import { normalizeQishuiSong } from './qishuiNormalize';
import { qishuiSongId } from './qishuiMutations';
import { requestQishui } from './qishuiTransport';

// Explicit playability checks are short-lived account facts; playback failures never change them.
const checks = new Map<string, { at: number; availability: ProviderSongAvailability }>();
let revision = 0;
export function clearQishuiPlayback() { revision++; checks.clear(); }
export async function readQishuiSongs(raw: unknown[]) {
    const songs = raw.map(normalizeQishuiSong);
    if (!songs.length) return songs;
    const mine = revision;
    try {
        const data = await requestQishui<{ statuses: QishuiTrackCheck[] }>('check_tracks', { ids: songs.map(song => String(song.id)) });
        if (mine !== revision) return songs;
        const wanted = new Set(songs.map(song => String(song.id)));
        for (const row of data.statuses) {
            if (!wanted.has(row.id) || !Number.isInteger(row.riskResult) || row.riskResult < 0) continue;
            checks.delete(row.id);
            checks.set(row.id, { at: Date.now(), availability: row.riskResult === 0
                ? { state: 'playable' } : { state: 'unknown', reason: 'restricted' } });
        }
        while (checks.size > 500) checks.delete(checks.keys().next().value!);
    } catch (error) {
        // A failed optional check must not hide otherwise readable songs or imply a takedown.
        console.warn('[Qishui] Track availability check failed', error);
    }
    return songs;
}
export const qishuiPlayback: OnlinePlaybackProvider = {
    audioQualityLevels: ['standard'],
    async getSongDetail(id) { return (await readQishuiSongs([await requestQishui('song_detail', { id: String(id) })]))[0]; },
    getAudioSource: (song, quality) => requestQishui<ProviderAudioSource>('audio', { id: qishuiSongId(song), quality }),
    getAvailability(song) {
        const check = checks.get(qishuiSongId(song));
        return check && Date.now() - check.at < 60_000 ? check.availability : { state: 'unknown' };
    },
};

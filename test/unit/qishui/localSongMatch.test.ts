import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { normalizeLyricMatchMetadataCandidate } from '@/services/onlineMetadataSearchService';
import { buildLocalSongLyricMatchContext } from '@/utils/lyrics/localSongMatchContext';
import { autoMatchBestLyric } from '@/utils/lyrics/autoMatchBestLyric';
import type { LocalSong, UnifiedSong } from '@/types';

// A stored manual selection must win over a different version ranked first during later lyric matching.
afterEach(() => vi.restoreAllMocks());

describe('local-song Qishui metadata rematching', () => {
    it('keeps the selected track when a different version heads the search results', async () => {
        const selected: UnifiedSong = {
            id: '7123456789012345678', name: 'Selected song', artists: [{ id: 'artist', name: 'Artist' }],
            album: { id: 'album', name: 'Album' }, durationMs: 200000,
            sourceRef: { kind: 'online', providerId: 'qishui', mediaId: '7123456789012345678' },
        };
        const candidate = normalizeLyricMatchMetadataCandidate('qishui', selected, {
            title: selected.name, artist: 'Artist', album: 'Album', durationMs: 200000,
        });
        const local: LocalSong = {
            id: 'local-1', filePath: 'Library/song.flac', fileSize: 1, mimeType: 'audio/flac', addedAt: 1,
            titleOrigin: 'manual-match',
            title: candidate.title, fileName: 'song.flac', duration: candidate.durationMs, noAutoMatch: true,
            importedMetadata: { artistNames: [], title: 'song', titleSource: 'filename' },
            onlineMetadata: { ...candidate, matchMode: 'manual', matchedAt: 1 },
        };
        const context = buildLocalSongLyricMatchContext(local);
        const provider = getOnlineMusicProvider('qishui')!;
        vi.spyOn(provider, 'getAvailability').mockReturnValue({ configured: true });
        vi.spyOn(provider.search!, 'searchSongs').mockResolvedValue({
            items: [{ ...selected, id: 'other-version',
                sourceRef: { kind: 'online', providerId: 'qishui', mediaId: 'other-version' } }, selected],
            hasMore: false, nextOffset: 2,
        });
        const fetch = vi.spyOn(provider.lyrics!, 'getLyrics').mockResolvedValue({
            lyrics: { lines: [{ fullText: 'Lyric', startTime: 0, endTime: 1, words: [] }], isWordByWord: true },
            isPureMusic: false,
        });
        const result = await autoMatchBestLyric(context.title, context.artist, context.durationMs, {
            album: context.album, preferredSource: 'qishui', metadataCandidate: context.metadataCandidate,
            exactMatchOnly: Boolean(context.metadataCandidate),
        });
        expect(result).toMatchObject({ source: 'qishui', id: selected.id });
        expect(fetch).toHaveBeenCalledExactlyOnceWith(selected);
    });
});

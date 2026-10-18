import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import { clearPrefetchRuntime, prefetchNearbySongs } from '@/services/prefetchService';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { useAutomixSettingsStore } from '@/stores/useAutomixSettingsStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';

// test/unit/prefetchLibraryAnalysis.test.ts
// Local and Navidrome songs are analysed for automix like online ones: the current track and the one
// after it. Without a profile at either end every library transition came out a plain fade, and the
// transition animations, which do not draw a plain fade, never showed for a library queue.

const { ensureTrackProfile, setAnalysisScope } = vi.hoisted(() => ({
    ensureTrackProfile: vi.fn(async (_request: { song: SongResult; audioUrl?: string | null }) => { }),
    setAnalysisScope: vi.fn(),
}));

vi.mock('@/services/automix/profileService', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/automix/profileService')>()),
    ensureTrackProfile,
    setAnalysisScope,
}));

const base = (id: string, name: string) => ({
    id,
    name,
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
});

const local = (id: string, name: string): SongResult => ({
    ...base(id, name),
    isLocal: true,
    localRef: { songId: id },
    sourceRef: { kind: 'local', mediaId: id },
} as unknown as SongResult);

const navidrome = (id: string, name: string): SongResult => ({
    ...base(id, name),
    isNavidrome: true,
    navidromeData: { id, streamUrl: `https://navi.test/rest/stream?id=${id}` },
    sourceRef: { kind: 'navidrome', mediaId: id },
} as unknown as SongResult);

describe('prefetchNearbySongs on a library queue', () => {
    beforeEach(() => {
        ensureTrackProfile.mockClear();
        setAnalysisScope.mockClear();
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.stubGlobal('window', globalThis);
        vi.stubGlobal('requestIdleCallback', (run: () => void) => { run(); return 0; });
        useAudioSettingsStore.setState({ loopMode: 'off' });
        usePlaybackStore.setState({ isFmMode: false });
        useAutomixSettingsStore.setState({ automixEnabled: true, transitionMode: 'automix' });
    });

    afterEach(() => {
        clearPrefetchRuntime();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        useAutomixSettingsStore.setState({ automixEnabled: false });
    });

    const run = async (currentSong: SongResult, queue: SongResult[]) => {
        await prefetchNearbySongs(currentSong, queue, 'high');
        await new Promise(resolve => setTimeout(resolve, 0));
        return ensureTrackProfile.mock.calls.map(([{ song, audioUrl }]) => [song.name, audioUrl]);
    };

    it('analyses the current local song and the next, both read off their files', async () => {
        const queue = [local('a', 'Alpha'), local('b', 'Bravo'), local('c', 'Charlie')];

        const analysed = await run(queue[0], queue);

        expect(setAnalysisScope.mock.lastCall?.[0].map((song: SongResult) => song.name)).toEqual(['Alpha', 'Bravo']);
        expect(analysed).toEqual([['Alpha', null], ['Bravo', null], ['Charlie', null]]);
    });

    it('analyses Navidrome songs from their stream URLs', async () => {
        const queue = [navidrome('a', 'Alpha'), navidrome('b', 'Bravo')];

        const analysed = await run(queue[0], queue);

        expect(analysed).toEqual([
            ['Alpha', 'https://navi.test/rest/stream?id=a'],
            ['Bravo', 'https://navi.test/rest/stream?id=b'],
        ]);
    });

    it('analyses nothing while blending is off', async () => {
        useAutomixSettingsStore.setState({ automixEnabled: false });
        const queue = [local('a', 'Alpha'), local('b', 'Bravo')];

        expect(await run(queue[0], queue)).toEqual([]);
    });
});

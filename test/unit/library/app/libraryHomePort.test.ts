import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibraryHomePort } from '@/library/app/createLibraryHomePort';
import { createLibraryHomeActions } from '@/library/core/home/libraryHomeActions.service';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { usePersonalFmModeStore } from '@/stores/usePersonalFmModeStore';
import { DEFAULT_PERSONAL_FM_CATALOG } from '@/services/onlineMusic/fmModes';
import type { HomeSurfaceProps } from '@/components/app/home/homeSurfaceTypes';
import type { SongResult } from '@/types';

// Card requests that lose their provider during either await must never request or play the new provider's stream.
const api = vi.hoisted(() => ({ getPersonalFm: vi.fn(), getPersonalFmCatalog: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: api }));
vi.mock('@/services/localMusicService', () => ({ importFolder: vi.fn(), resyncAllFolders: vi.fn(), LOCAL_MUSIC_SCAN_PROGRESS_EVENT: 'scan' }));
vi.mock('@/services/localPlaylistFileService', () => ({ importLocalPlaylistFile: vi.fn() }));
const selection = { mode: 'SCENE_RCMD' as const, scene: '33' };
const catalog = { ...DEFAULT_PERSONAL_FM_CATALOG, scenes: [{ id: '33', category: 'activity', labelKey: '', labelFallback: 'Driving', keywords: [] }] };
const songs = [{ id: 's1' }] as SongResult[];
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};
const setup = () => {
    const play = vi.fn();
    const port = createLibraryHomePort(() => ({ localSongs: [], onRefreshLocalSongs: vi.fn(), onPlaySong: play }) as unknown as HomeSurfaceProps);
    return { port, play, actions: createLibraryHomeActions(port) };
};
beforeEach(() => {
    vi.clearAllMocks();
    useOnlineProviderAccountStore.setState({ activeProviderId: 'qishui' });
    usePersonalFmModeStore.setState({ catalogs: {}, providerSelections: {} });
    api.getPersonalFmCatalog.mockResolvedValue(catalog);
    api.getPersonalFm.mockResolvedValue(songs);
});
describe('home radio provider binding', () => {
    it('keeps a selected scene and starts its own stream when the provider stays put', async () => {
        const { port } = setup();
        expect(await port.getPersonalFm(selection)).toEqual(songs);
        expect(api.getPersonalFm).toHaveBeenCalledWith({ mode: 'SCENE_RCMD', submode: '33' });
    });
    it('abandons the scene before requesting songs if its catalogue returns after a provider switch', async () => {
        const pending = deferred<typeof catalog>();
        api.getPersonalFmCatalog.mockReturnValue(pending.promise);
        const { port } = setup();
        const result = port.getPersonalFm(selection);
        useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' });
        pending.resolve(catalog);
        expect(await result).toEqual([]);
        expect(api.getPersonalFm).not.toHaveBeenCalled();
        expect(usePersonalFmModeStore.getState().providerSelections).toEqual({});
    });
    it('does not play a scene whose songs return after a provider switch', async () => {
        const pending = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValue(pending.promise);
        const { actions, play } = setup();
        const result = actions.openOnlineCard({ id: 'scene-33', name: 'Driving', type: 'radio', raw: { personalFm: selection } }, 'qishui', vi.fn());
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalled());
        useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' });
        pending.resolve(songs);
        await result;
        expect(play).not.toHaveBeenCalled();
    });
    it('does not reinterpret a stale card as belonging to the new provider', async () => {
        useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' });
        const { actions, play } = setup();
        await actions.openOnlineCard({ id: 'scene-33', name: 'Driving', type: 'radio', raw: { personalFm: selection } }, 'qishui', vi.fn());
        expect(api.getPersonalFmCatalog).not.toHaveBeenCalled();
        expect(api.getPersonalFm).not.toHaveBeenCalled();
        expect(play).not.toHaveBeenCalled();
    });
});

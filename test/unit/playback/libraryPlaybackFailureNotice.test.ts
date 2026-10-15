// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/playback/libraryPlaybackFailureNotice.test.ts
// 本地与 Navidrome 点歌失败不经过 presenter，各自弹一条错误消息；这里锁定它们同样报告一次
// （hostExtensionHooks.notifyPlaybackFailed → Folium playback.failed），phase 'play'，没有原因码，不自动跳过。

const env = vi.hoisted(() => {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (key: string) => (entries.has(key) ? entries.get(key)! : null),
            setItem: (key: string, value: string) => { entries.set(key, String(value)); },
            removeItem: (key: string) => { entries.delete(key); },
            clear: () => { entries.clear(); },
            key: (index: number) => Array.from(entries.keys())[index] ?? null,
            get length() { return entries.size; },
        },
        configurable: true,
        writable: true,
    });
    return {
        navidromeConfig: null as unknown,
        streamUrlError: null as Error | null,
    };
});

vi.mock('@/services/db', () => ({
    getFromCache: async () => null,
    saveToCache: async () => {},
    removeFromCache: async () => {},
    getLocalSong: async () => null,
    getLocalSongs: async () => [],
    saveLocalSong: async () => {},
    saveLocalSongs: async () => {},
    getSessionData: async () => ({}),
    clearSession: async () => {},
    getCacheEntriesByPrefix: async () => [],
    getFromCacheWithMigration: async () => null,
}));
vi.mock('@/services/localMusicService', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/localMusicService')>()),
    getAudioFromLocalSong: vi.fn(async () => null),
}));
vi.mock('@/services/navidromeService', async importOriginal => {
    const actual = await importOriginal<typeof import('@/services/navidromeService')>();
    return {
        ...actual,
        getNavidromeConfig: () => env.navidromeConfig,
        navidromeApi: {
            ...actual.navidromeApi,
            getStreamUrl: () => {
                if (env.streamUrlError) throw env.streamUrlError;
                return 'https://navidrome.example/stream';
            },
        },
    };
});

import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useLibraryPlaybackController } from '@/hooks/useLibraryPlaybackController';
import { installPlaybackFailedListener } from '@/services/hostExtensionHooks';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import type { LocalSong } from '@/types';
import type { NavidromeSong } from '@/types/navidrome';

const localSong = {
    id: 'local-1',
    fileName: 'a.mp3',
    filePath: 'Music/a.mp3',
    title: 'Local Song',
    titleOrigin: 'import',
    importedMetadata: { title: 'Local Song', titleSource: 'filename', artistNames: ['Someone'] },
    duration: 100,
    fileSize: 1234,
    fileLastModified: 1000,
    mimeType: 'audio/mpeg',
    addedAt: 1,
    folderName: 'Music',
} as unknown as LocalSong;

const navidromeSong = {
    id: 'nd-1',
    name: 'Navi Song',
    artists: [{ id: 0, name: 'Band' }],
    album: { id: 0, name: 'Record' },
    durationMs: 1000,
    isNavidrome: true,
    navidromeData: { id: 'nd-1', streamUrl: 'https://navidrome.example/stream' },
} as unknown as NavidromeSong;

type Controller = {
    onPlayLocalSong: (song: LocalSong) => Promise<void>;
    onPlayNavidromeSong: (song: NavidromeSong) => Promise<void>;
};

const listener = vi.fn();
let controller: Controller;
let root: Root;

const Probe: React.FC = () => {
    const anyRef = useRef<unknown>(null);
    controller = useLibraryPlaybackController({
        likedSongIds: new Set<string>(),
        setLyrics: () => {},
        setIsLyricsLoading: () => {},
        setLikedSongIds: () => {},
        navigateToPlaybackView: () => {},
        persistLastPlaybackCache: async () => {},
        restoreCachedThemeForSong: async () => {},
        interruptStagePlaybackForMainTransition: () => null,
        blobUrlRef: anyRef,
        shouldAutoPlayRef: anyRef,
        currentSongRef: anyRef,
        currentOnlineAudioUrlFetchedAtRef: anyRef,
    } as never) as unknown as Controller;
    return null;
};

beforeEach(async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    env.navidromeConfig = null;
    env.streamUrlError = null;
    listener.mockReset();
    installPlaybackFailedListener(listener);
    useStatusMessageStore.setState({ message: null });
    root = createRoot(document.createElement('div'));
    await act(async () => { root.render(React.createElement(Probe)); });
});

afterEach(async () => {
    installPlaybackFailedListener(null);
    await act(async () => { root.unmount(); });
    vi.restoreAllMocks();
});

describe('library playback failure reports', () => {
    it('reports a local song whose file cannot be read', async () => {
        await act(async () => { await controller.onPlayLocalSong(localSong); });
        expect(useStatusMessageStore.getState().message).toMatchObject({ type: 'error', text: expect.any(String) });
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith({
            song: expect.objectContaining({ name: 'Local Song', localRef: expect.objectContaining({ songId: 'local-1' }) }),
            reason: null,
            phase: 'play',
            willAutoSkip: false,
        });
    });

    it('reports a Navidrome song when Navidrome is not configured', async () => {
        await act(async () => { await controller.onPlayNavidromeSong(navidromeSong); });
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith({ song: navidromeSong, reason: null, phase: 'play', willAutoSkip: false });
    });

    it('reports a Navidrome song whose load threw, with the carrier itself', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        env.navidromeConfig = { serverUrl: 'https://navidrome.example', username: 'u', password: 'p' };
        env.streamUrlError = new Error('stream url failed');
        await act(async () => { await controller.onPlayNavidromeSong(navidromeSong); });
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith({ song: navidromeSong, reason: null, phase: 'play', willAutoSkip: false });
    });
});

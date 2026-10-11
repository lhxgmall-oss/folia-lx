import { describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import { usePlaybackStore } from '../../../src/stores/usePlaybackStore';
import {
    WALL_TOOLS_SHUFFLE_COMMAND,
    WALL_TOOLS_THEME_COMMAND,
    createWallToolsHostStore,
    type WallToolsHostDeps,
} from '../../../src/components/app/wall-tools/useWallToolsHost';

// test/unit/app/wallToolsHost.test.ts
// App 给墙面工具的宿主（useWallToolsHost 的纯部分 createWallToolsHostStore）：快照去重后才通知、动作总读最新依赖、
// 点歌播放不跳页、队列动作接到对应的应用实现、就地编辑之后带着编辑前的队列交给预取刷新。

const song = (id: number): SongResult => ({
    id,
    name: `Song ${id}`,
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
} as SongResult);

const makeDeps = (overrides: Partial<WallToolsHostDeps> = {}): WallToolsHostDeps => ({
    invokeCommandById: vi.fn(),
    canInvokeCommandById: vi.fn(() => true),
    isGeneratingTheme: false,
    previewVolume: vi.fn(),
    navigateToPlayer: vi.fn(),
    playQueue: [song(1), song(2)],
    playSong: vi.fn(),
    moveQueueSongToNext: vi.fn(),
    moveQueueSongToEnd: vi.fn(),
    removeQueueSong: vi.fn(),
    moveQueueSong: vi.fn(),
    clearQueue: vi.fn(),
    saveCurrentQueueAsLocalPlaylist: vi.fn(async () => {}),
    refreshPrefetchAfterQueueEdit: vi.fn(),
    ...overrides,
});

describe('createWallToolsHostStore', () => {
    it('starts unavailable and notifies only when the snapshot actually changes', () => {
        const { host, publish } = createWallToolsHostStore({ current: makeDeps() });
        expect(host.getSnapshot()).toEqual({ themeGeneration: 'unavailable', canShuffleQueue: false });
        const listener = vi.fn();
        const unsubscribe = host.subscribe(listener);

        publish({ themeGeneration: 'unavailable', canShuffleQueue: false });
        expect(listener).not.toHaveBeenCalled();
        publish({ themeGeneration: 'ready', canShuffleQueue: true });
        expect(listener).toHaveBeenCalledTimes(1);
        const ready = host.getSnapshot();
        publish({ themeGeneration: 'ready', canShuffleQueue: true });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(host.getSnapshot()).toBe(ready);
        publish({ themeGeneration: 'busy', canShuffleQueue: true });
        expect(listener).toHaveBeenCalledTimes(2);

        unsubscribe();
        publish({ themeGeneration: 'ready', canShuffleQueue: false });
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('plays a queue song without leaving the wall, with the latest queue', () => {
        const latest = { current: makeDeps() };
        const { host } = createWallToolsHostStore(latest);
        const nextDeps = makeDeps({ playQueue: [song(3), song(4)] });
        latest.current = nextDeps;
        host.playQueueSong(song(4));
        expect(nextDeps.playSong).toHaveBeenCalledWith(song(4), nextDeps.playQueue, false, { shouldNavigateToPlayer: false });
    });

    it('routes the wall and queue actions to the app implementations', async () => {
        const deps = makeDeps();
        const { host } = createWallToolsHostStore({ current: deps });
        host.shuffleQueue();
        host.generateTheme();
        expect(deps.invokeCommandById).toHaveBeenNthCalledWith(1, WALL_TOOLS_SHUFFLE_COMMAND);
        expect(deps.invokeCommandById).toHaveBeenNthCalledWith(2, WALL_TOOLS_THEME_COMMAND);
        host.previewVolume(0.3);
        expect(deps.previewVolume).toHaveBeenCalledWith(0.3);
        host.openPlayer();
        expect(deps.navigateToPlayer).toHaveBeenCalledTimes(1);
        host.playQueueSongNext(1);
        host.moveQueueSongToEnd(2);
        host.removeQueueSong(3);
        host.moveQueueSong(4, 0);
        host.clearQueue();
        expect(deps.moveQueueSongToNext).toHaveBeenCalledWith(1);
        expect(deps.moveQueueSongToEnd).toHaveBeenCalledWith(2);
        expect(deps.removeQueueSong).toHaveBeenCalledWith(3);
        expect(deps.moveQueueSong).toHaveBeenCalledWith(4, 0);
        expect(deps.clearQueue).toHaveBeenCalledTimes(1);
        await host.saveQueueAsPlaylist('Mix');
        expect(deps.saveCurrentQueueAsLocalPlaylist).toHaveBeenCalledWith('Mix');
    });

    it('passes a failed save through as a rejection', async () => {
        const deps = makeDeps({ saveCurrentQueueAsLocalPlaylist: vi.fn(async () => { throw new Error('nope'); }) });
        const { host } = createWallToolsHostStore({ current: deps });
        await expect(host.saveQueueAsPlaylist('Mix')).rejects.toThrow('nope');
    });

    it('hands every in-place queue edit the queue from before it to the prefetch refresh', () => {
        const before = [song(1), song(2), song(3)];
        usePlaybackStore.setState({ playQueue: before });
        const after = [song(1), song(3), song(2)];
        const deps = makeDeps({
            moveQueueSong: vi.fn(() => usePlaybackStore.setState({ playQueue: after })),
        });
        const { host } = createWallToolsHostStore({ current: deps });
        host.moveQueueSong(2, 1);
        expect(deps.moveQueueSong).toHaveBeenCalledWith(2, 1);
        expect(deps.refreshPrefetchAfterQueueEdit).toHaveBeenCalledTimes(1);
        expect(vi.mocked(deps.refreshPrefetchAfterQueueEdit).mock.calls[0][0]).toBe(before);

        host.playQueueSongNext(2);
        host.moveQueueSongToEnd(0);
        host.removeQueueSong(1);
        expect(deps.refreshPrefetchAfterQueueEdit).toHaveBeenCalledTimes(4);
        // 洗牌（命令自己会重新预取）、清空与点歌都不经这一步。
        host.shuffleQueue();
        host.clearQueue();
        host.playQueueSong(song(1));
        expect(deps.refreshPrefetchAfterQueueEdit).toHaveBeenCalledTimes(4);
        usePlaybackStore.setState({ playQueue: [] });
    });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';

// test/unit/player-panel/createQueueMutations.test.ts
// 队列变更里的拖拽移动（moveQueueSong）：写回播放 store 并持久化；没变或越界时什么都不做。

const mocks = vi.hoisted(() => ({
    setPlayQueue: vi.fn(),
    setStatusMessage: vi.fn(),
}));

vi.mock('../../../src/stores/usePlaybackStore', () => ({ setPlayQueue: mocks.setPlayQueue }));
vi.mock('../../../src/stores/useStatusMessageStore', () => ({ setStatusMessage: mocks.setStatusMessage }));

const { createQueueMutations } = await import('../../../src/components/app/player-panel/createQueueMutations');

const song = (id: number): SongResult => ({
    id,
    name: `Song ${id}`,
    artists: [],
    album: { id: 1, name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(id) },
} as SongResult);

const setup = () => {
    const playQueue = [song(1), song(2), song(3), song(4)];
    const persistLastPlaybackCache = vi.fn(async () => {});
    const mutations = createQueueMutations({
        currentSong: playQueue[0],
        playQueue,
        persistLastPlaybackCache,
        t: key => key,
        queueAddBehavior: 'append',
    });
    return { playQueue, persistLastPlaybackCache, mutations };
};

describe('createQueueMutations.moveQueueSong', () => {
    beforeEach(() => {
        mocks.setPlayQueue.mockReset();
        mocks.setStatusMessage.mockReset();
    });

    it('moves one song to the target index, writes the queue and persists it', () => {
        const { playQueue, persistLastPlaybackCache, mutations } = setup();
        mutations.moveQueueSong(3, 1);
        const expected = [playQueue[0], playQueue[3], playQueue[1], playQueue[2]];
        expect(mocks.setPlayQueue).toHaveBeenCalledWith(expected);
        expect(persistLastPlaybackCache).toHaveBeenCalledWith(playQueue[0], expected);
        expect(playQueue.map(item => item.id)).toEqual([1, 2, 3, 4]);
    });

    it('does nothing for a no-op or an out-of-range move', () => {
        const { persistLastPlaybackCache, mutations } = setup();
        mutations.moveQueueSong(2, 2);
        mutations.moveQueueSong(0, 4);
        mutations.moveQueueSong(-1, 0);
        expect(mocks.setPlayQueue).not.toHaveBeenCalled();
        expect(persistLastPlaybackCache).not.toHaveBeenCalled();
    });
});

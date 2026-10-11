import type { SongResult } from '../types';
import { getPlaybackSongSource, hasMixedPlaybackSources, isLocalPlaybackSong } from './appPlaybackGuards';

// src/utils/queueReorder.ts
// 播放队列的纯变换与判定：单项移动（墙面工具的队列浮岛拖拽、Electron 舞台的 move 请求共用），
// 以及「当前队列能不能存成本地歌单」（播放页面板的队列页与墙面工具的队列浮岛共用同一个判定）。

/**
 * 把 from 位置的一项移到 to 位置（to 是移动完成后它所在的下标）。
 * from === to 或任一下标越界时原样返回同一个数组（调用方可以据此判断「没变」）。
 */
export const moveQueueItem = <T>(queue: readonly T[], from: number, to: number): T[] => {
    const length = queue.length;
    const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < length;
    if (from === to || !inRange(from) || !inRange(to)) return queue as T[];
    const next = [...queue];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
};

/**
 * 当前队列能不能存成本地歌单：正在播放的是本地歌，队列非空、全部是本地歌（不混来源）。
 * TODO: Define cross-source playlist export before enabling playlist creation for mixed queues.
 */
export const canSaveQueueAsLocalPlaylist = (currentSong: SongResult | null | undefined, queue: readonly SongResult[]): boolean => (
    isLocalPlaybackSong(currentSong)
    && queue.length > 0
    && !hasMixedPlaybackSources(queue as SongResult[])
    && queue.every(song => getPlaybackSongSource(song) === 'local')
);

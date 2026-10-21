import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { normalizeQqSong } from './qqNormalize';
import { requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqSongDetail.ts
// `/getSongInfo` 单曲详情：播放侧的 getSongDetail、搜索结果补 mid、歌单写入补数字 id 都用它。

export const getQqSongDetail = async (id: MediaId): Promise<UnifiedSong | null> => {
    const response = await requestQq<any>('song_info', { songmid: String(id) });
    const track = response?.response?.songinfo?.data?.track_info;
    if (!track || typeof track !== 'object') return null;
    const song = normalizeQqSong(track);
    return song.qqMid ? song : null;
};

// 数字 songid（没有前导 0 的正整数）。songmid 是 14 位、以 0 开头的字母数字串，不会被认成它。
const isQqNumericSongId = (id: MediaId): boolean => /^[1-9]\d*$/.test(String(id).trim());

/**
 * 按 id 查歌：播放侧的 getSongDetail（omni.getSongDetail / getSongDetails，folium.omni 的 resolveSongs 经它）。
 * 收到的可能是播放键 songmid，也可能是这首歌的 `UnifiedSong.id`，也就是数字 songid（qqNormalize.ts）。
 *
 * 按数字 songid 现在查不到：上游 3.3.3 的 `/getSongInfo` 把 query 里的 songid 当字符串交给 QQ，QQ 对字符串的
 * song_id 回 404 空壳；拿它当 songmid 查，也只能查到空壳。所以这样的 id 不去查、也不答 null —— null 会被调用方
 * 读成「QQ 没有这首歌」，还会被记下来 —— 而是以 `unavailable` 拒绝：这一次没查成，id 本身还有效。
 * 怎么按数字 songid 查到（另走一个接受数字 song_id 的请求先换到 mid，或等上游把它转成数字）还没定。
 */
export const getQqSongDetailById = async (id: MediaId): Promise<UnifiedSong | null> => {
    if (isQqNumericSongId(id)) {
        throw new OnlineProviderError('unavailable', 'QQ Music cannot look a song up by its numeric song id yet', 'qq', { songId: String(id).trim() });
    }
    return getQqSongDetail(id);
};

const qqSongDetailRequests = new Map<string, Promise<UnifiedSong | null>>();

// 同一首歌的专辑与歌手会各触发一次解析，两次落到同一个 songmid 上，去重掉重复请求。
export const requestQqSongDetail = (songmid: string): Promise<UnifiedSong | null> => {
    const cached = qqSongDetailRequests.get(songmid);
    if (cached) return cached;

    const request = getQqSongDetail(songmid).finally(() => {
        if (qqSongDetailRequests.get(songmid) === request) qqSongDetailRequests.delete(songmid);
    });
    qqSongDetailRequests.set(songmid, request);
    return request;
};

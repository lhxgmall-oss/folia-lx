import type { BravaisItem } from './bravaisLayer';

// src/library/suites/bravais/bravaisTileForm.ts
// 磁贴按种类换的「样子」（设计稿 §7.7）：墙上歌曲 / 专辑 / 歌单 / 歌手混排时，只靠左上角的小类型标签分不清，
// 所以集合加书脊、歌手换双色调人像，歌曲保持满版海报。判定只看条目的种类与「点了是否直接播放」，不看显示文字。

/** poster = 满版海报（歌曲、私人 FM）；spine = 左侧书脊（会打开成一张曲目表的集合）；portrait = 双色调人像（歌手）。 */
export type BravaisTileForm = 'poster' | 'spine' | 'portrait';

/**
 * 条目画成哪种样子：
 * - 专辑、歌单、文件夹、每日推荐（feed 里不直接播放的那张）：打开是一张有限的曲目表，加书脊；
 * - 私人 FM（feed、direct）：点了直接播放的电台流，不是集合，保持海报；
 * - 歌手：双色调人像；歌曲：海报。
 */
export const resolveBravaisTileForm = (item: Pick<BravaisItem, 'kind' | 'direct'>): BravaisTileForm => {
    switch (item.kind) {
        case 'artist': return 'portrait';
        case 'album':
        case 'playlist':
        case 'folder': return 'spine';
        case 'feed': return item.direct ? 'poster' : 'spine';
        default: return 'poster';
    }
};

/** 书脊上的曲目数：只有画书脊、曲目数已知（正整数）时才有。 */
export const resolveSpineTrackCount = (
    form: BravaisTileForm,
    trackCount: number | undefined,
    label: (count: number) => string,
): string | undefined => (
    form === 'spine' && typeof trackCount === 'number' && Number.isFinite(trackCount) && trackCount > 0
        ? label(Math.floor(trackCount))
        : undefined
);

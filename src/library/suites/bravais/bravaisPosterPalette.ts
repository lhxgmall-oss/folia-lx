import { useEffect, useState } from 'react';
import type { Theme } from '../../../types';
import { mixColors } from '../../../components/visualizer/colorMix';
import { resolveTemperaPalette } from '../../../components/visualizer/tempera/temperaPalette';
import { extractRepresentativeColors } from '../../../utils/colorExtractor';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import type { BravaisItem } from './bravaisLayer';

// src/library/suites/bravais/bravaisPosterPalette.ts
// 歌手海报与旁边那面墙共用的一套颜色：和凝彩一样，从封面取色、走凝彩的渐变调色板（resolveTemperaPalette 的 gradient：
// 每个封面色往主题方向混一点，再按明暗排到纸色 → 墨色的四档阶梯上）。取色的封面是这位歌手最火的三张专辑——热门歌曲
// 是按热度排的，取前几首所属专辑里不重复的前三张封面；热门歌曲没有封面时退回墙上的专辑。
// 海报的底色、几何形、虚影、立体字的残影、碎字，墙上封面的那层色调，海报与墙之间的渐隐，都从这一套里取（CSS 变量
// 写在 stage 根节点上）。没取到颜色（没有封面、跨源读不到像素）时是 null，CSS 里的灰色就是回退。

const SOURCE_COVER_COUNT = 3;
const SAMPLE_COVER_PX = 128;

/** 最火的三张专辑封面：热门歌曲（按热度）所属专辑在前，不够再用墙上的专辑。 */
export const resolvePosterPaletteSources = (items: readonly BravaisItem[]): string[] => {
    const urls: string[] = [];
    const add = (url: string | undefined) => {
        if (url && !urls.includes(url) && urls.length < SOURCE_COVER_COUNT) urls.push(url);
    };
    items.forEach(item => { if (item.kind === 'track') add(item.coverUrl); });
    items.forEach(item => { if (item.kind === 'album') add(item.coverUrl); });
    return urls;
};

export type BravaisPosterPalette = {
    /** 海报底色（中心）与压暗的四周。 */
    ground: string;
    groundDeep: string;
    edge: string;
    /** 装定妆照的几何形里垫底的颜色、它的虚影。 */
    shape: string;
    ghost: string;
    /** 立体残影从浅到深的四层。 */
    extrude: readonly [string, string, string, string];
    /** 碎字。 */
    scrap: string;
    /** 墙上封面那层色调。 */
    wallTint: string;
};

/** 海报自己的「主题」：深色纸、浅色墨，主色与副色就是封面色（凝彩的 gradient 会把封面色往它们混一点）。 */
const posterTheme = (colors: readonly string[]): Theme => ({
    name: 'bravais-poster',
    backgroundColor: '#2b2b2e',
    primaryColor: '#f4f4f4',
    accentColor: colors[0],
    secondaryColor: colors[1] ?? colors[0],
    fontStyle: 'sans',
    animationIntensity: 'normal',
});

/** 封面色 → 海报的一套颜色。少于两个颜色时没有调色板（回退到 CSS 里的灰）。 */
export const resolveBravaisPosterPalette = (colors: readonly string[]): BravaisPosterPalette | null => {
    if (colors.length < 2) return null;
    const palette = resolveTemperaPalette(posterTheme(colors), { colorMode: 'gradient' }, [...colors]);
    const { paper, tone1, tone2, tone3 } = palette;
    return {
        ground: tone2,
        groundDeep: mixColors(tone1, tone2, 0.4),
        edge: mixColors(paper, tone1, 0.5),
        shape: mixColors(paper, tone1, 0.3),
        ghost: tone1,
        extrude: [tone3, mixColors(tone2, tone3, 0.5), tone2, tone1],
        scrap: tone3,
        wallTint: tone3,
    };
};

/** 几张封面各取两个代表色，交错排（第一张的主色、第二张的主色、第三张的主色、第一张的次色……）。 */
export const interleavePosterColors = (perCover: readonly (readonly string[])[]) => {
    const out: string[] = [];
    for (let rank = 0; rank < 2; rank += 1) perCover.forEach(colors => { if (colors[rank]) out.push(colors[rank]); });
    return out;
};

/** 封面组合 → 调色板（含取不到的 null），模块里缓存，同一位歌手只取一次。 */
const cache = new Map<string, BravaisPosterPalette | null>();

export const useBravaisPosterPalette = (urls: readonly string[], enabled: boolean): BravaisPosterPalette | null => {
    const key = enabled ? urls.join('\n') : '';
    const [palette, setPalette] = useState<BravaisPosterPalette | null>(() => (key ? cache.get(key) ?? null : null));
    useEffect(() => {
        if (!key) {
            setPalette(null);
            return undefined;
        }
        if (cache.has(key)) {
            setPalette(cache.get(key) ?? null);
            return undefined;
        }
        let cancelled = false;
        Promise.all(urls.map(url => extractRepresentativeColors(getSizedCoverUrl(url, SAMPLE_COVER_PX), 2).catch(() => [])))
            .then(perCover => {
                const next = resolveBravaisPosterPalette(interleavePosterColors(perCover));
                cache.set(key, next);
                if (!cancelled) setPalette(next);
            });
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key 已经编码了 urls
    }, [key]);
    return palette;
};

/** 调色板 → stage 根节点上的 CSS 变量（海报、墙的色调、渐隐都读它们）。 */
export const posterPaletteVars = (palette: BravaisPosterPalette | null): Record<string, string> => (palette ? {
    '--bravais-poster-ground': palette.ground,
    '--bravais-poster-ground-deep': palette.groundDeep,
    '--bravais-poster-edge': palette.edge,
    '--bravais-poster-shape-fill': palette.shape,
    '--bravais-poster-ghost': palette.ghost,
    '--bravais-poster-extrude-1': palette.extrude[0],
    '--bravais-poster-extrude-2': palette.extrude[1],
    '--bravais-poster-extrude-3': palette.extrude[2],
    '--bravais-poster-extrude-4': palette.extrude[3],
    '--bravais-poster-scrap': palette.scrap,
    '--bravais-poster-wall-tint': palette.wallTint,
} : {});

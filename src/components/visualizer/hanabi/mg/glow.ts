// Copyright (c) 2026 chthollyphile
import { createBloomFilter, type BloomFilter } from '../../pixi/bloomFilter';
import type { PixiModule } from '../types';

// src/components/visualizer/hanabi/mg/glow.ts
// 烟花层的辉光：复用共享的 dual-filter bloom（pixi/bloomFilter.ts：亮部提取 → 逐级降采样 → 上采样叠加），参数调成花火的「热芯 + 宽光晕」。
// 只在 tuning.glow > 0 时由 scene 挂到烟花层上；强度随 tuning 变化时调 setHanabiGlow，不必重建。
// 滤镜区域跟着烟花层的包围盒走，刚升空的一颗火星只有一两个像素宽：共享 bloom 在一级都降不了时原样透传，不会让整帧中断。

const BASE = {
    strength: 1.1,
    threshold: 0.2,
    knee: 0.25,
    levels: 5,
    spread: 0.85,
    tint: [1, 0.96, 0.9] as [number, number, number],
};

/** amount = tuning.glow（0..2）；padding 让光晕能晕出烟花层的包围盒（逻辑像素）。 */
export const createHanabiGlow = (pixi: PixiModule, amount: number, padding = 48): BloomFilter => {
    const filter = createBloomFilter(pixi, { ...BASE, strength: BASE.strength * Math.max(0, amount), padding });
    // 满分辨率：Pixi 的 Filter 默认 resolution 是 1，1.5× / 2× 渲染时烟花层会先画成 1× 再被拉伸（lumisynth 在共享 bloom 里设，
    // folia 的共享 bloom 由各自的运行时设：绘光在 lumiereGroupFilters，花火在这里）。
    filter.resolution = 'inherit';
    return filter;
};

export const setHanabiGlow = (filter: BloomFilter, amount: number) => {
    filter.options.strength = BASE.strength * Math.max(0, amount);
};

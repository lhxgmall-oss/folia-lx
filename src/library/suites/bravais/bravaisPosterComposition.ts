// src/library/suites/bravais/bravaisPosterComposition.ts
// 歌手海报的构图（纯计算）：和凝彩一样按种子定死——同一个歌手每次打开都是同一幅，换一个歌手换一幅。种子是层的 key
// （含歌手 id），渲染层零随机。随机的只有装定妆照的几何形（三种斜切块、圆窗）与它朝哪边；文字、按钮的位置都不随机。
// 凝彩的效果只挑了几样（纸底与颗粒、色块里的定妆照与网点、名字与热门歌的立体字）：虚影、描边、贯穿线、角标、斜线
// 小方块、「· · ·」、散落的碎字都拿掉了，叠在倾斜的墙旁边太乱。
// 几何形只占海报上部（不低于 76% 高），下面留给名字、热门歌曲与按钮。坐标都是海报宽高的百分比。

export type BravaisPosterShape =
    | { kind: 'polygon'; points: readonly (readonly [number, number])[] }
    | { kind: 'circle'; cx: number; cy: number };

export type BravaisPosterComposition = {
    shape: BravaisPosterShape;
};

/** FNV-1a，字符串 → 32 位种子。 */
export const hashPosterSeed = (seed: string) => {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0;
    return hash;
};

/** mulberry32：同一个种子永远同一串数。 */
export const createRandom = (seed: number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
};

/** 几何形都画在右边，mirror 时左右翻过来。 */
const SHAPES: readonly BravaisPosterShape[] = [
    { kind: 'polygon', points: [[18, 0], [100, 0], [100, 58], [46, 74]] },
    // 原来这里是倒三角（[6,0] [100,0] [62,70]），尖朝下的大三角太像梗图模板：换成横跨整幅、下缘斜切的一块。
    { kind: 'polygon', points: [[0, 0], [100, 0], [100, 50], [0, 66]] },
    { kind: 'polygon', points: [[44, 0], [100, 0], [100, 66], [58, 76]] },
    { kind: 'circle', cx: 64, cy: 30 },
];

export const resolvePosterComposition = (seed: string): BravaisPosterComposition => {
    // 取随机数的顺序与原来一样（先形状、再朝向），每个歌手抽到的形状不变。
    const random = createRandom(hashPosterSeed(seed));
    const base = SHAPES[Math.floor(random() * SHAPES.length)];
    const mirror = random() < 0.4;
    const flip = (x: number) => (mirror ? 100 - x : x);
    const shape: BravaisPosterShape = base.kind === 'polygon'
        ? { kind: 'polygon', points: base.points.map(([x, y]) => [flip(x), y] as const) }
        : { kind: 'circle', cx: flip(base.cx), cy: base.cy };
    return { shape };
};

/** 多边形 → CSS clip-path；圆窗按海报较短的一边定半径（宽高都用容器单位，保持正圆）。 */
export const posterShapeClipPath = (shape: BravaisPosterShape) => (
    shape.kind === 'polygon'
        ? `polygon(${shape.points.map(([x, y]) => `${x}% ${y}%`).join(', ')})`
        : `circle(min(34cqw, 27cqh) at ${shape.cx}% ${shape.cy}%)`
);

/**
 * 专辑海报的构图（参考稿 album.png 竖过来）：同样按种子定死，同一张专辑每次一样。随机的只有：封面倾斜的角度与方向、
 * 胶带贴在哪、纸与色块之间那道斜线的两端高度（哪边高）、强调色下划线的长短、标题里放大那个词的错位与旋转、描边水印字
 * 在哪一边。文字与按钮的位置不随机。坐标是海报宽高的百分比。
 */
export type BravaisAlbumComposition = {
    coverDeg: number;
    tape: { x: number; deg: number };
    /** 纸的下缘：左端与右端的高度（%）。 */
    divider: { left: number; right: number };
    underline: number;
    hero: { x: number; y: number; deg: number };
    ghostSide: 'left' | 'right';
};

export const resolveAlbumComposition = (seed: string): BravaisAlbumComposition => {
    const random = createRandom(hashPosterSeed(`album:${seed}`));
    const between = (min: number, max: number) => min + (max - min) * random();
    const sign = () => (random() < 0.5 ? -1 : 1);
    const high = between(44, 50);
    const low = between(56, 62);
    const leftHigh = random() < 0.5;
    return {
        coverDeg: between(2.5, 6) * sign(),
        tape: { x: between(28, 58), deg: between(-5, 5) },
        divider: leftHigh ? { left: high, right: low } : { left: low, right: high },
        underline: between(38, 62),
        hero: { x: between(0.04, 0.12), y: between(0.12, 0.22), deg: between(2, 7) * sign() },
        ghostSide: random() < 0.5 ? 'left' : 'right',
    };
};

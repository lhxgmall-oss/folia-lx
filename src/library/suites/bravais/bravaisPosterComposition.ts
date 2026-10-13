// src/library/suites/bravais/bravaisPosterComposition.ts
// 歌手海报的构图（纯计算）：和凝彩一样按种子定死——同一个歌手每次打开都是同一幅，换一个歌手换一幅。种子是层的 key
// （含歌手 id），渲染层零随机。随机的只有构图：装定妆照的几何形（斜切块、倒三角、竖条、圆窗）与它朝哪边，虚影错开的
// 方向，两条贯穿线的高度与角度，碎字的位置、字号与角度，斜线小方块与「· · ·」的位置。文字、按钮的位置都不随机。
// 几何形只占海报上部（不低于 76% 高），下面留给名字、热门歌曲与按钮。坐标都是海报宽高的百分比。

export type BravaisPosterShape =
    | { kind: 'polygon'; points: readonly (readonly [number, number])[] }
    | { kind: 'circle'; cx: number; cy: number };

export type BravaisPosterScrap = { x: number; y: number; size: number; deg: number; opacity: number };

export type BravaisPosterComposition = {
    shape: BravaisPosterShape;
    /** 虚影错开的方向（px）。 */
    ghost: { x: number; y: number };
    through: readonly { y: number; deg: number }[];
    scraps: readonly BravaisPosterScrap[];
    /** 斜线小方块在哪一边（与几何形相反的那边）、多高。 */
    hatch: { side: 'left' | 'right'; y: number };
    dots: { x: number; y: number };
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
    { kind: 'polygon', points: [[6, 0], [100, 0], [62, 70]] },
    { kind: 'polygon', points: [[44, 0], [100, 0], [100, 66], [58, 76]] },
    { kind: 'circle', cx: 64, cy: 30 },
];

/** 碎字的候选位置：避开名字所在的中下部，挑三个。 */
const SCRAP_SPOTS: readonly { x: number; y: number }[] = [
    { x: -2, y: 30 }, { x: 70, y: 78 }, { x: 56, y: 72 }, { x: 4, y: 20 }, { x: 64, y: 86 }, { x: 30, y: 24 },
];

export const resolvePosterComposition = (seed: string): BravaisPosterComposition => {
    const random = createRandom(hashPosterSeed(seed));
    const between = (min: number, max: number) => min + (max - min) * random();
    const base = SHAPES[Math.floor(random() * SHAPES.length)];
    const mirror = random() < 0.4;
    const flip = (x: number) => (mirror ? 100 - x : x);
    const shape: BravaisPosterShape = base.kind === 'polygon'
        ? { kind: 'polygon', points: base.points.map(([x, y]) => [flip(x), y] as const) }
        : { kind: 'circle', cx: flip(base.cx), cy: base.cy };
    const ghostSign = random() < 0.5 ? -1 : 1;
    const spots = [...SCRAP_SPOTS];
    const scraps = [0, 1, 2].map(rank => {
        const spot = spots.splice(Math.floor(random() * spots.length), 1)[0];
        return {
            x: spot.x,
            y: spot.y,
            size: [8, 5, 3.6][rank] * between(0.85, 1.15),
            deg: between(-9, 9),
            opacity: [0.8, 0.55, 0.45][rank],
        };
    });
    return {
        shape,
        ghost: { x: 16 * ghostSign * (mirror ? -1 : 1), y: 16 },
        through: [
            { y: between(8, 18), deg: between(2, 7) * (random() < 0.5 ? -1 : 1) },
            { y: between(78, 88), deg: between(3, 8) * (random() < 0.5 ? -1 : 1) },
        ],
        scraps,
        hatch: { side: mirror ? 'right' : 'left', y: between(11, 16) },
        dots: { x: between(30, 56), y: between(7, 11) },
    };
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

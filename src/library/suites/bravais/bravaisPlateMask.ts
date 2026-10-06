import { getBlockSize, type WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_METRICS } from './bravaisConstants';
import { resolveSlotFace, type BravaisDisplay } from './bravaisDisplay';
import type { BravaisFrame } from './bravaisFrame';
import { isPlateHole, isSeeThroughFace } from './bravaisLook';

// src/library/suites/bravais/bravaisPlateMask.ts
// 透光的实色底板（设计稿 §11）在哪里挖洞，纯计算。底板是全屏固定、不透明、不 blur 的一层（放进世界层跟相机走会
// 让带遮罩的大图层每次块集合变化都重新栅格化，实测拖动掉到约 97fps），用 CSS 遮罩挖洞：
//
//   mask-image:     [底色] [左半墙的洞] [右半墙的洞] [缝]
//   mask-composite:  subtract  add       add          —
//
// 结果 = 底色 ×（1 − 洞的并集）。左右两半墙在缝张开时偏移不同，所以两半的洞各是一张 SVG（evenodd 路径，原点在洞的
// 外接框），各自写 mask-position；缝开合只改位置，不重建路径。缝下面也挖空，透明档的半透明纸条才透得出去。
// 遮罩只在挖洞的矩形集合变了（可见块集合、窗集合、换档、聚焦卡落定）时重建；相机每帧只写 mask-position / -size。
//
// 聚焦卡块内让位的过渡期间，主底板在整块上挖一个洞，块里另有一块「局部底板」（同一身底色的全屏层，遮罩 = 块矩形
// 减去块内窗磁贴的实时矩形，最多 12 个渐变层），每帧按磁贴的实际位置写；落定后主底板按新位置挖洞、同一帧收起局部底板。

export type PlateRect = { x: number; y: number; width: number; height: number };
export type PlateHoleSet = { left: PlateRect[]; right: PlateRect[] };

/** 一半墙的洞：SVG 遮罩图与它在世界里的外接框。 */
export type PlateMaskLayer = { url: string; path: string; x: number; y: number; width: number; height: number };
export type PlateMaskGeometry = { left: PlateMaskLayer | null; right: PlateMaskLayer | null };

export const EMPTY_PLATE_MASK: PlateMaskGeometry = Object.freeze({ left: null, right: null });

/** 局部底板向左 / 上多盖的世界像素：落在前一块尾部的缝隙里（那里没有磁贴），免得与主底板的洞边缘抗锯齿出接缝。 */
export const LIVE_PLATE_BLEED = 2;

const SOLID_LAYER = 'linear-gradient(#000 0 0)';

/** 一个块的世界矩形（块宽含它尾部的缝隙）。 */
export const getBlockRect = (column: number, row: number): PlateRect => {
    const size = getBlockSize(BRAVAIS_METRICS);
    return { x: column * size.width, y: row * size.height, width: size.width, height: size.height };
};

export const blockKeyOf = (slot: Pick<WallSlot, 'column' | 'row'>) => `${slot.column},${slot.row}`;

/**
 * 主底板要挖的洞：可见 slot 里的窗（部分透明的结构窗、透明档有限墙的空 slot）与全透明档透着的内容磁贴，按缝锚点
 * 分到左右两半（与 BravaisWall 分世界层同一条规则）。聚焦块用让位后的矩形；`liveBlockKey` 是正在让位的块，
 * 整块挖掉（块里交给局部底板）。
 */
export const collectPlateHoles = ({
    slots,
    display,
    expandedSlotKey,
    reflow,
    anchorX,
    liveBlockKey,
}: {
    slots: readonly WallSlot[];
    display: BravaisDisplay | null;
    expandedSlotKey: string | null;
    reflow: ReadonlyMap<string, PlateRect>;
    anchorX: number | null;
    liveBlockKey: string | null;
}): PlateHoleSet => {
    const holes: PlateHoleSet = { left: [], right: [] };
    if (!display || display.look === 'solid') return holes;
    const sideOf = (x: number) => (anchorX !== null && x < anchorX ? holes.left : holes.right);
    let liveBlock: PlateRect | null = null;
    for (const slot of slots) {
        if (liveBlockKey !== null && blockKeyOf(slot) === liveBlockKey) {
            liveBlock ??= getBlockRect(slot.column, slot.row);
            continue;
        }
        const { kind } = resolveSlotFace(display, slot);
        if (!isPlateHole(kind, isSeeThroughFace(display.look, kind, slot.key === expandedSlotKey))) continue;
        const rect = reflow.get(slot.key) ?? slot;
        sideOf(slot.x).push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
    if (liveBlock) sideOf(liveBlock.x).push(liveBlock);
    return holes;
};

/** 正在让位的块里要在局部底板上挖洞的 slot（窗与透着的内容磁贴；展开的那张画封面，不算）。 */
export const collectBlockHoleKeys = (
    slots: readonly WallSlot[],
    display: BravaisDisplay | null,
    expandedSlotKey: string | null,
    blockKey: string,
): string[] => {
    if (!display || display.look === 'solid') return [];
    return slots
        .filter((slot) => {
            if (blockKeyOf(slot) !== blockKey) return false;
            const { kind } = resolveSlotFace(display, slot);
            return isPlateHole(kind, isSeeThroughFace(display.look, kind, slot.key === expandedSlotKey));
        })
        .map(slot => slot.key);
};

const round = (value: number) => Math.round(value * 100) / 100;

/** 一组洞的 SVG 路径（原点在外接框左上角）与外接框；没有洞时为 null。 */
export const buildHolePath = (rects: readonly PlateRect[]) => {
    if (rects.length === 0) return null;
    let left = Number.POSITIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (const rect of rects) {
        left = Math.min(left, rect.x);
        top = Math.min(top, rect.y);
        right = Math.max(right, rect.x + rect.width);
        bottom = Math.max(bottom, rect.y + rect.height);
    }
    const path = rects
        .map(rect => `M${round(rect.x - left)} ${round(rect.y - top)}h${round(rect.width)}v${round(rect.height)}h${round(-rect.width)}Z`)
        .join('');
    return { path, x: left, y: top, width: right - left, height: bottom - top };
};

const toMaskUrl = (path: string, width: number, height: number) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">`
        + `<path fill="#fff" fill-rule="evenodd" d="${path}"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};

/**
 * 一半墙的遮罩层。路径与外接框都没变时原样返回上一份（不重新生成 data URL，浏览器也就不重新解码），
 * 所以调用方可以放心在每次渲染时调用，只有洞真的变了才算一次重建。
 */
export const buildPlateMaskLayer = (rects: readonly PlateRect[], previous: PlateMaskLayer | null): PlateMaskLayer | null => {
    const hole = buildHolePath(rects);
    if (!hole) return null;
    if (previous && previous.path === hole.path && previous.x === hole.x && previous.y === hole.y
        && previous.width === hole.width && previous.height === hole.height) {
        return previous;
    }
    return { ...hole, url: toMaskUrl(hole.path, hole.width, hole.height) };
};

/** 主底板的 mask-image（四层：底色、左半的洞、右半的洞、缝）。 */
export const plateMaskImage = (geometry: PlateMaskGeometry) => [
    SOLID_LAYER,
    geometry.left?.url ?? 'none',
    geometry.right?.url ?? 'none',
    SOLID_LAYER,
].join(', ');

export const PLATE_MASK_COMPOSITE = 'subtract, add, add, add';

const px = (value: number) => `${round(value)}px`;

const layerBox = (layer: PlateMaskLayer | null, half: { x: number; y: number }, scale: number) => (
    layer
        ? { position: `${px(half.x + layer.x * scale)} ${px(half.y + layer.y * scale)}`, size: `${px(layer.width * scale)} ${px(layer.height * scale)}` }
        : { position: '0px 0px', size: '0px 0px' }
);

/** 每帧要写的 mask-position / mask-size：两半的洞跟各自的世界层平移，缝的洞跟缝走。 */
export const computePlateMaskStyle = (frame: BravaisFrame, geometry: PlateMaskGeometry) => {
    const left = layerBox(geometry.left, frame.left, frame.scale);
    const right = layerBox(geometry.right, frame.right, frame.scale);
    const seam = frame.seam.visible
        ? { position: `${px(frame.seam.x - frame.seam.width / 2)} 0px`, size: `${px(frame.seam.width)} 100%` }
        : { position: '0px 0px', size: '0px 0px' };
    return {
        position: ['0px 0px', left.position, right.position, seam.position].join(', '),
        size: ['100% 100%', left.size, right.size, seam.size].join(', '),
    };
};

/**
 * 局部底板的遮罩：块矩形（向左 / 上多盖 LIVE_PLATE_BLEED）减去块内窗磁贴此刻的矩形，全部用渐变层，
 * 每帧只改位置与尺寸。`half` 是块所在那一半世界层此刻的平移。
 */
export const computeLivePlateMaskStyle = (
    block: PlateRect,
    holes: readonly PlateRect[],
    half: { x: number; y: number },
    scale: number,
) => {
    const toScreen = (rect: PlateRect) => ({
        position: `${px(half.x + rect.x * scale)} ${px(half.y + rect.y * scale)}`,
        size: `${px(rect.width * scale)} ${px(rect.height * scale)}`,
    });
    const base = toScreen({
        x: block.x - LIVE_PLATE_BLEED,
        y: block.y - LIVE_PLATE_BLEED,
        width: block.width + LIVE_PLATE_BLEED,
        height: block.height + LIVE_PLATE_BLEED,
    });
    const layers = [base, ...holes.map(toScreen)];
    return {
        image: layers.map(() => SOLID_LAYER).join(', '),
        composite: ['subtract', ...holes.map(() => 'add')].join(', '),
        position: layers.map(layer => layer.position).join(', '),
        size: layers.map(layer => layer.size).join(', '),
    };
};

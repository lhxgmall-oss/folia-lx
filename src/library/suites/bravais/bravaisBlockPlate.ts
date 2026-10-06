import { getBlockSize, getBlockSlots, type WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_METRICS } from './bravaisConstants';
import { resolveSlotFace, type BravaisDisplay } from './bravaisDisplay';
import { isPlateHole, isSeeThroughFace } from './bravaisLook';

// src/library/suites/bravais/bravaisBlockPlate.ts
// 透光的实色底板（设计稿 §11）按块画，纯计算。每个已挂载的 12×8 块一张内联 SVG：实色、evenodd 路径，外框减去块里
// 最多 12 个窗洞（部分透明的结构窗、透明档有限墙的空 slot、全透明档透着的内容磁贴）。SVG 放在世界层里、磁贴之下，
// 随相机一起平移，所以拖动不写任何东西；不用 CSS 遮罩。
//
// 外框只向左 / 上多盖 PLATE_BLEED（落在前一块尾部的缝隙里：那里没有磁贴），相邻块之间没有接缝，也不伸进下一块的
// 磁贴；右 / 下止于本块尾部缝隙的末尾。例外是缝右侧的第一列块：缝两侧的墙各让出半个开口加半个 GAP，前一块
// （在左半）的尾部缝隙不在右半，这一列向左多盖一整个 GAP，正好铺到缝的右边沿（缝全开时）——缝的开口下面没有底板，
// 透明档的半透明纸条透得出去。
//
// 洞按块里全部 12 个 slot 算（不看裁剪），所以拖动、补挂只会新挂块，已挂的块路径不变；窗集合变了（翻牌开关窗、换挡、
// 有限墙空 slot 变化、聚焦卡让位）只有受影响的块路径会变。

export type PlateRect = { x: number; y: number; width: number; height: number };

/** 外框向左 / 上多盖的世界像素（前一块尾部缝隙的一部分）。 */
export const PLATE_BLEED = 2;

/** 一个块的底板：SVG 在世界里的外框、路径（原点在外框左上角）与它的洞。 */
export type PlateBlock = {
    key: string;
    column: number;
    row: number;
    x: number;
    y: number;
    width: number;
    height: number;
    d: string;
    /** 挖洞的 slot 与它们此刻（让位落定后）的矩形；聚焦卡让位的逐帧重画按 key 取实时矩形。 */
    holes: readonly { key: string; rect: PlateRect }[];
};

export type PlateBlockSet = { left: readonly PlateBlock[]; right: readonly PlateBlock[] };

export const EMPTY_PLATE_BLOCKS: PlateBlockSet = Object.freeze({ left: [], right: [] });

export const blockKeyOf = (slot: Pick<WallSlot, 'column' | 'row'>) => `${slot.column},${slot.row}`;

/** 一个块的世界矩形（块宽含它尾部的缝隙）。 */
export const getBlockRect = (column: number, row: number): PlateRect => {
    const size = getBlockSize(BRAVAIS_METRICS);
    return { x: column * size.width, y: row * size.height, width: size.width, height: size.height };
};

/** 块在缝锚点左边（进左半世界层）：与 BravaisWall 分 slot 同一条规则（缝开在块边界上，块不会跨过锚点）。 */
export const isLeftOfAnchor = (column: number, anchorX: number | null) => (
    anchorX !== null && getBlockRect(column, 0).x < anchorX
);

/** 底板 SVG 的外框：向左 / 上多盖 PLATE_BLEED；缝右侧第一列向左多盖一整个 GAP。 */
export const getPlateFrame = (column: number, row: number, anchorX: number | null): PlateRect => {
    const block = getBlockRect(column, row);
    const seamEdge = anchorX !== null && Math.abs(block.x - BRAVAIS_METRICS.gap / 2 - anchorX) < 1e-6;
    const left = seamEdge ? BRAVAIS_METRICS.gap : PLATE_BLEED;
    return { x: block.x - left, y: block.y - PLATE_BLEED, width: block.width + left, height: block.height + PLATE_BLEED };
};

/** 已挂载的块（slot 列表里出现过的），按首次出现的顺序。 */
export const collectMountedBlocks = (slots: readonly WallSlot[]) => {
    const blocks = new Map<string, { column: number; row: number }>();
    for (const slot of slots) {
        const key = blockKeyOf(slot);
        if (!blocks.has(key)) blocks.set(key, { column: slot.column, row: slot.row });
    }
    return blocks;
};

/** 块里要挖洞的 slot 与矩形（让位中的块取让位后的矩形；展开的那张画封面，不算洞）。 */
export const collectBlockHoles = (
    column: number,
    row: number,
    display: BravaisDisplay,
    expandedSlotKey: string | null,
    reflow: ReadonlyMap<string, PlateRect>,
) => {
    const holes: { key: string; rect: PlateRect }[] = [];
    for (const slot of getBlockSlots(column, row, BRAVAIS_METRICS)) {
        const { kind } = resolveSlotFace(display, slot);
        if (!isPlateHole(kind, isSeeThroughFace(display.look, kind, slot.key === expandedSlotKey))) continue;
        const rect = reflow.get(slot.key) ?? slot;
        holes.push({ key: slot.key, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    }
    return holes;
};

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * 底板路径：外框一个矩形，每个洞一个矩形，evenodd 填充。洞先裁到外框里（聚焦卡让位的回弹会让磁贴短暂越出块，
 * 越出的部分在 evenodd 下会被填实）。坐标相对外框左上角。
 */
export const buildPlatePath = (frame: PlateRect, holes: readonly PlateRect[]) => {
    let d = `M0 0h${round(frame.width)}v${round(frame.height)}h${round(-frame.width)}Z`;
    const right = frame.x + frame.width;
    const bottom = frame.y + frame.height;
    for (const hole of holes) {
        const left = Math.max(frame.x, hole.x);
        const top = Math.max(frame.y, hole.y);
        const width = Math.min(right, hole.x + hole.width) - left;
        const height = Math.min(bottom, hole.y + hole.height) - top;
        if (width <= 0 || height <= 0) continue;
        d += `M${round(left - frame.x)} ${round(top - frame.y)}h${round(width)}v${round(height)}h${round(-width)}Z`;
    }
    return d;
};

/** 一个块的底板（外框、路径、洞）。 */
export const buildPlateBlock = (
    column: number,
    row: number,
    display: BravaisDisplay,
    expandedSlotKey: string | null,
    reflow: ReadonlyMap<string, PlateRect>,
    anchorX: number | null,
): PlateBlock => {
    const frame = getPlateFrame(column, row, anchorX);
    const holes = collectBlockHoles(column, row, display, expandedSlotKey, reflow);
    return {
        key: `${column},${row}`,
        column,
        row,
        ...frame,
        d: buildPlatePath(frame, holes.map(hole => hole.rect)),
        holes,
    };
};

/** 判断两份块底板画的是不是同一个东西（路径与外框都相同）。 */
export const isSamePlateBlock = (a: PlateBlock, b: PlateBlock) => (
    a.d === b.d && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
);

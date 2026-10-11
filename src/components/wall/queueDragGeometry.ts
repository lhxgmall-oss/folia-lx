// src/components/wall/queueDragGeometry.ts
// 墙面工具队列浮岛（WallToolsQueueIsland）拖拽排序的纯几何：指针位置 → 落点下标、落点两侧的行该让开多少、
// 指针贴近上下边缘时的自动滚动速度。不 import React，useQueueDragReorder 每一帧调它们，单测直接测。
// 行高是固定的（虚拟列表的每一行一样高），所以「落点」就是被拖那一行的中线落在第几个槽里：
// 其余行按 queueRowShift 让开之后，被拖的那首正好占住这个槽，它也就是 moveQueueSong 的 to（移动完成后的下标）。

/** 浮岛里一行的高度（px）。 */
export const QUEUE_ISLAND_ROW_HEIGHT = 40;
/** 指针在手柄上按下后要移动超过这么多才算开始拖（px），免得手抖把一次点击当成拖拽。 */
export const QUEUE_DRAG_THRESHOLD_PX = 4;
/** 指针离列表上下边缘这么近时开始自动滚动（px）。 */
export const QUEUE_AUTOSCROLL_EDGE_PX = 32;
/** 自动滚动最快每帧这么多（px），贴到边缘或越出边缘时达到。 */
export const QUEUE_AUTOSCROLL_MAX_SPEED = 14;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * 落点下标：被拖那一行的中线在列表内容坐标里的位置（clientY − 列表顶 + scrollTop − 抓取点偏移 + 半行高）
 * 落在第几个槽。夹在 [0, rowCount − 1]；没有行时返回 0。
 */
export const resolveDropIndex = ({
    centerY,
    rowHeight = QUEUE_ISLAND_ROW_HEIGHT,
    rowCount,
}: {
    centerY: number;
    rowHeight?: number;
    rowCount: number;
}): number => {
    if (rowCount <= 0 || !Number.isFinite(centerY)) return 0;
    return clamp(Math.floor(centerY / rowHeight), 0, rowCount - 1);
};

/**
 * 拖拽中第 index 行该让开多少（px）：被拖的那首从 from 去 to，中间的行朝 from 的方向挪一行。
 * 往下拖（from < to）时 (from, to] 上移一行；往上拖时 [to, from) 下移一行；其余与被拖的那行本身不动。
 * 行组件按 rowProps 里的 from / to 自己算，所以拖拽中途才挂载的行（自动滚动带进视口的）也对得上。
 */
export const queueRowShift = (index: number, from: number, to: number, rowHeight = QUEUE_ISLAND_ROW_HEIGHT): number => {
    if (index === from || from === to) return 0;
    if (from < to && index > from && index <= to) return -rowHeight;
    if (to < from && index >= to && index < from) return rowHeight;
    return 0;
};

/**
 * 自动滚动速度（px / 帧，负数往上）：指针进入上 / 下边缘 edge 以内时按深入程度线性加速，贴边或越出时最快。
 * 列表放不下 edge 两倍高时边缘区按一半高收窄，免得上下两区重叠。
 */
export const autoScrollVelocity = ({
    pointerY,
    top,
    bottom,
    edge = QUEUE_AUTOSCROLL_EDGE_PX,
    maxSpeed = QUEUE_AUTOSCROLL_MAX_SPEED,
}: {
    pointerY: number;
    top: number;
    bottom: number;
    edge?: number;
    maxSpeed?: number;
}): number => {
    const zone = Math.min(edge, Math.max(0, (bottom - top) / 2));
    if (zone <= 0) return 0;
    if (pointerY < top + zone) {
        const depth = clamp((top + zone - pointerY) / zone, 0, 1);
        return -maxSpeed * depth;
    }
    if (pointerY > bottom - zone) {
        const depth = clamp((pointerY - (bottom - zone)) / zone, 0, 1);
        return maxSpeed * depth;
    }
    return 0;
};

import { clampReservedPerBlock, getBlockReservedMask } from '../../../components/wall/blockReservedSlots';
import { getBlockSlots, parseWallSlotKey } from '../../../components/wall/wallSlots';
import {
    LIBRARY_WALL_LOOKS,
    MAX_LIBRARY_WALL_WINDOWS_PER_BLOCK,
    MIN_LIBRARY_WALL_WINDOWS_PER_BLOCK,
    type LibraryWallLook,
} from '../../../utils/libraryWallLook';
import { BRAVAIS_METRICS } from './bravaisConstants';

// src/library/suites/bravais/bravaisLook.ts
// 透光（设计稿 §11）的纯规则：三档下每个 slot 是什么（内容 / 实色空画框 / 窗）、哪些内容磁贴「透」（全透明档）、
// 部分透明的窗是插入的结构位（rank→slot 跳过它，k = 每块窗数），起点磁贴不落在窗上，翻牌用的「面」的身份，
// 外观动作的换挡。不碰 React、不碰 DOM。

/** stage 读到的透光偏好（useLibraryWallLookStore 的两个字段）。 */
export type BravaisWallLook = { look: LibraryWallLook; windowsPerBlock: number };

export const SOLID_WALL_LOOK: BravaisWallLook = Object.freeze({ look: 'solid', windowsPerBlock: 0 });

/**
 * 一张磁贴是什么：
 * - content：显示一项（全透明档下它同时是窗，见 isSeeThroughFace）；
 * - wall：实色空画框（实色档，或透明档里无限墙的「还没有内容」）；
 * - window：窗——部分透明的结构位，或透明档里有限墙剩下的空 slot。没有内容，不可聚焦、不可点。
 */
export type BravaisTileKind = 'content' | 'wall' | 'window';

/** 内容要跳过的保留位数：只有部分透明档有结构窗。 */
export const resolveReservedPerBlock = (wallLook: BravaisWallLook): number => (
    wallLook.look === 'partial' ? clampReservedPerBlock(wallLook.windowsPerBlock) : 0
);

/**
 * 没有内容的 slot 是窗还是空画框。`reserved` = 它是部分透明的结构位。有限墙（B7 的过滤 / 搜索结果）剩下的空 slot
 * 在透明档也是窗；无限墙没有内容只会是层还没加载到，画成空画框，免得加载期间整面墙透成一片。
 */
export const resolveEmptySlotKind = (
    look: LibraryWallLook,
    reserved: boolean,
    layerMode: 'infinite' | 'finite',
): Exclude<BravaisTileKind, 'content'> => {
    if (reserved) return 'window';
    return look !== 'solid' && layerMode === 'finite' ? 'window' : 'wall';
};

/** 全透明档：墙上的内容磁贴不画封面、只留标题（也是窗）；聚焦卡（展开的那张）照常画封面。 */
export const isSeeThroughFace = (look: LibraryWallLook, kind: BravaisTileKind, expanded: boolean) => (
    look === 'clear' && kind === 'content' && !expanded
);

/** 这张磁贴在底板上要不要挖洞（窗，或全透明档里透着的内容磁贴）。 */
export const isPlateHole = (kind: BravaisTileKind, seeThrough: boolean) => kind === 'window' || seeThrough;

/**
 * 一张磁贴「面」的身份：翻牌状态机按它比较前后（换档 / 换窗数时开或关窗的 slot 也要翻）。
 * 墙面为 null（与 B6 一致），窗是 `window`，透着的内容在条目 key 前加 `~`。
 */
export const bravaisFaceKey = (itemKey: string | null, kind: BravaisTileKind, seeThrough: boolean): string | null => {
    if (kind === 'window') return 'window';
    if (kind === 'wall' || itemKey === null) return null;
    return seeThrough ? `~${itemKey}` : itemKey;
};

/**
 * 起点 slot 不能是窗（窗没有内容，点不到）：换挡后起点刚好成了窗时，换成同一块里离它最近的非窗 slot，
 * 起点那一项仍是第 1 项、仍在原处附近。
 */
export const resolveStartSlotKey = (startSlotKey: string | null, reservedPerBlock: number): string | null => {
    const address = startSlotKey ? parseWallSlotKey(startSlotKey) : null;
    if (!address || reservedPerBlock <= 0) return startSlotKey;
    const mask = getBlockReservedMask(address.column, address.row, reservedPerBlock);
    if (!mask[address.slotIndex]) return startSlotKey;
    const slots = getBlockSlots(address.column, address.row, BRAVAIS_METRICS);
    const origin = slots[address.slotIndex];
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const slot of slots) {
        if (mask[slot.slotIndex] || !origin) continue;
        const distance = (slot.centerX - origin.centerX) ** 2 + (slot.centerY - origin.centerY) ** 2;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = slot.key;
        }
    }
    return best;
};

/** stage 报给宿主的遮挡：只有实色档完全盖住播放页（有任何窗或半透明的缝都不算）。 */
export const occludesPlayerFor = (look: LibraryWallLook) => look === 'solid';

/** 外观动作「透光」：实色 → 部分透明 → 全透明 → 实色。 */
export const nextWallLook = (look: LibraryWallLook): LibraryWallLook => {
    const index = LIBRARY_WALL_LOOKS.indexOf(look);
    return LIBRARY_WALL_LOOKS[(index + 1) % LIBRARY_WALL_LOOKS.length] ?? 'partial';
};

/** 外观动作「多开 / 少开一个窗」：只在部分透明且没到边界时可用，不可用时为 null。 */
export const stepWindowsPerBlock = (wallLook: BravaisWallLook, delta: 1 | -1): number | null => {
    if (wallLook.look !== 'partial') return null;
    const next = wallLook.windowsPerBlock + delta;
    return next < MIN_LIBRARY_WALL_WINDOWS_PER_BLOCK || next > MAX_LIBRARY_WALL_WINDOWS_PER_BLOCK ? null : next;
};

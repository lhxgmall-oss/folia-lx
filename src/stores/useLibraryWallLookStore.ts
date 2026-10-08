import { create } from 'zustand';
import {
    clampLibraryWallWindowsPerBlock,
    normalizeLibraryWallLook,
    type LibraryWallLook,
} from '../utils/libraryWallLook';

// src/stores/useLibraryWallLookStore.ts
// bravais 资料库界面的墙面偏好：「透光」档位 look（实色 / 部分透明 / 全透明，默认实色）与部分透明时每块的窗数
// windowsPerBlock（1–6，默认 3）；集合磁贴的叠页边开关 collectionStackEdges（默认开，设计稿 §7.7）。
// 放在 app 层而不是 suite 里，因为设置 UI（components/modal/settings）不能 import suite；bravais 的 stage 读这里。
// 只在 bravais 是生效 suite 时才有界面入口（library/app/bravaisLibraryActive；界面设置的「Bravais」分组）。
//
// @note look 与 windowsPerBlock 是用户明确决定「不进外观配置导入导出」的视觉偏好（2026-10-06）。不要按
// settings-feature-integration「视觉设置必须进 buildCurrentConfig / compressConfig / decompressConfig / validKeys /
// handleImportConfig」的规则把它们补进短码或 JSON，也不进同步的视觉设置快照。
// collectionStackEdges 没有这样的用户决定，按规则进了外观配置的导入导出（visualSettingsConfig、appearanceCodec 的 bse、
// 导入确认的「资料库墙」组）；不进同步快照（同步只覆盖播放页的视觉设置）。
//
// 存储读写都包 try/catch：存储不可用（隐私模式、配额满）时本次会话照常用内存里的值。
// 读到非法档位回默认档，读到越界或非数字的窗数钳制 / 回默认（规则在 utils/libraryWallLook）。

const LIBRARY_WALL_LOOK_KEY = 'library_wall_look';
const LIBRARY_WALL_WINDOWS_PER_BLOCK_KEY = 'library_wall_windows_per_block';
const LIBRARY_WALL_STACK_EDGES_KEY = 'library_wall_stack_edges';

const readStored = (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

const writeStored = (key: string, value: string) => {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(key, value);
    } catch {
        // Keep the value for this session when storage is unavailable.
    }
};

const readStoredLook = (): LibraryWallLook => normalizeLibraryWallLook(readStored(LIBRARY_WALL_LOOK_KEY));
const readStoredWindowsPerBlock = (): number => clampLibraryWallWindowsPerBlock(readStored(LIBRARY_WALL_WINDOWS_PER_BLOCK_KEY));
/** 默认开；只认 'false' 为关（读不到、非法值都按默认）。 */
const readStoredStackEdges = (): boolean => readStored(LIBRARY_WALL_STACK_EDGES_KEY) !== 'false';

export type LibraryWallLookState = {
    look: LibraryWallLook;
    /** 部分透明时每块（12 个 slot）开几个窗；档位不是部分透明时保留原值，切回来照旧。 */
    windowsPerBlock: number;
    /** 集合磁贴（专辑 / 歌单 / 文件夹 / 每日推荐）右下边缘的叠页边；关掉时集合就是普通海报（曲目数仍在标签里）。 */
    collectionStackEdges: boolean;
    /** 非法值回默认档后再写入。 */
    setLook: (look: LibraryWallLook) => void;
    /** 先钳到 1–6 再写入。 */
    setWindowsPerBlock: (windowsPerBlock: number) => void;
    setCollectionStackEdges: (enabled: boolean) => void;
    /** 从存储重新读一遍（存储被别处改写、或测试模拟重启时用）。 */
    hydrate: () => void;
};

export const useLibraryWallLookStore = create<LibraryWallLookState>(set => ({
    look: readStoredLook(),
    windowsPerBlock: readStoredWindowsPerBlock(),
    collectionStackEdges: readStoredStackEdges(),
    setLook: (look) => {
        const normalized = normalizeLibraryWallLook(look);
        writeStored(LIBRARY_WALL_LOOK_KEY, normalized);
        set({ look: normalized });
    },
    setWindowsPerBlock: (windowsPerBlock) => {
        const clamped = clampLibraryWallWindowsPerBlock(windowsPerBlock);
        writeStored(LIBRARY_WALL_WINDOWS_PER_BLOCK_KEY, String(clamped));
        set({ windowsPerBlock: clamped });
    },
    setCollectionStackEdges: (enabled) => {
        const value = Boolean(enabled);
        writeStored(LIBRARY_WALL_STACK_EDGES_KEY, String(value));
        set({ collectionStackEdges: value });
    },
    hydrate: () => set({
        look: readStoredLook(),
        windowsPerBlock: readStoredWindowsPerBlock(),
        collectionStackEdges: readStoredStackEdges(),
    }),
}));

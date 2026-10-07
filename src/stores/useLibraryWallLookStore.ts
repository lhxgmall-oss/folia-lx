import { create } from 'zustand';
import {
    clampLibraryWallWindowsPerBlock,
    normalizeLibraryWallLook,
    type LibraryWallLook,
} from '../utils/libraryWallLook';

// src/stores/useLibraryWallLookStore.ts
// bravais 资料库界面的「透光」偏好：档位 look（实色 / 部分透明 / 全透明，默认实色）与部分透明时每块的窗数
// windowsPerBlock（1–6，默认 3）。放在 app 层而不是 suite 里，因为设置 UI（components/modal/settings）不能 import suite；
// bravais 的 stage 读这里。只在 bravais 是生效 suite 时才有界面入口（library/app/bravaisLibraryActive）。
//
// @note 这是用户明确决定「不进外观配置导入导出」的视觉偏好（2026-10-06）。不要按 settings-feature-integration
// 「视觉设置必须进 buildCurrentConfig / compressConfig / decompressConfig / validKeys / handleImportConfig」的规则
// 把它补进短码或 JSON，也不进同步的视觉设置快照。
//
// 存储读写都包 try/catch：存储不可用（隐私模式、配额满）时本次会话照常用内存里的值。
// 读到非法档位回默认档，读到越界或非数字的窗数钳制 / 回默认（规则在 utils/libraryWallLook）。

const LIBRARY_WALL_LOOK_KEY = 'library_wall_look';
const LIBRARY_WALL_WINDOWS_PER_BLOCK_KEY = 'library_wall_windows_per_block';

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

export type LibraryWallLookState = {
    look: LibraryWallLook;
    /** 部分透明时每块（12 个 slot）开几个窗；档位不是部分透明时保留原值，切回来照旧。 */
    windowsPerBlock: number;
    /** 非法值回默认档后再写入。 */
    setLook: (look: LibraryWallLook) => void;
    /** 先钳到 1–6 再写入。 */
    setWindowsPerBlock: (windowsPerBlock: number) => void;
    /** 从存储重新读一遍（存储被别处改写、或测试模拟重启时用）。 */
    hydrate: () => void;
};

export const useLibraryWallLookStore = create<LibraryWallLookState>(set => ({
    look: readStoredLook(),
    windowsPerBlock: readStoredWindowsPerBlock(),
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
    hydrate: () => set({ look: readStoredLook(), windowsPerBlock: readStoredWindowsPerBlock() }),
}));

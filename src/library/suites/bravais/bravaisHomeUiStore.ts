import { create } from 'zustand';

// src/library/suites/bravais/bravaisHomeUiStore.ts
// 首页缝里的全局搜索框开没开（B9）。它不是导航（不写 history），也不是缝的等级：开着时首页窄缝临时展开成完整宽度的
// 搜索框（bravaisSeamTarget 的 search 变体），提交（走 onSearchCommitted 去 SearchWorkspace）、「关闭搜索」、Esc、
// 折叠缝、换 suite（stage 卸载）都会关上。模块作用域，stage 与 surface 共用。

type BravaisHomeUiState = {
    searchOpen: boolean;
};

export const useBravaisHomeUiStore = create<BravaisHomeUiState>(() => ({ searchOpen: false }));

export const setBravaisSearchOpen = (open: boolean) => {
    if (useBravaisHomeUiStore.getState().searchOpen !== open) useBravaisHomeUiStore.setState({ searchOpen: open });
};

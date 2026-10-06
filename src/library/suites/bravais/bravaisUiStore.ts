import { create } from 'zustand';

// src/library/suites/bravais/bravaisUiStore.ts
// stage 与集合 surface 之间、层描述以外的几样小状态（模块作用域，跨 stage 卸载存活）：
// - panelFor：列表面板开在哪一层（层 key）。面板是导航状态（设计稿 §5「面板」）：打开时写一条 history 记录
//   （bravaisPanelHistory），浏览器后退、Esc、‹ 都先关它；换到别的层不清掉——压栈后返回时面板仍开着，与 history 一致。
// - linkedKey / wallHoverKey：列表 ↔ 墙的联动（悬停列表行高亮墙上的副本；悬停磁贴高亮并滚到列表行）。
// - filterHost：缝里给命令面板内联过滤框的锚点（stage 画，集合 surface 注册过滤时用它做 anchor）。
// - focusFirst：stage 注册的「把键盘焦点交给墙上第 1 项」（过滤框里按 ↓）。
// - removalOrigin：聚焦卡「⋯ → 移出」时记下的 slot，移除的两段翻牌从它开始。

export type BravaisRemovalOrigin = { layerKey: string; slotKey: string };

export type BravaisUiState = {
    panelFor: string | null;
    linkedKey: string | null;
    wallHoverKey: string | null;
    filterHost: HTMLElement | null;
    focusFirst: (() => boolean) | null;
    removalOrigin: BravaisRemovalOrigin | null;
};

export const useBravaisUiStore = create<BravaisUiState>(() => ({
    panelFor: null,
    linkedKey: null,
    wallHoverKey: null,
    filterHost: null,
    focusFirst: null,
    removalOrigin: null,
}));

export const setBravaisFilterHost = (element: HTMLElement | null) => {
    if (useBravaisUiStore.getState().filterHost !== element) useBravaisUiStore.setState({ filterHost: element });
};

/** 给 useGridCommandFilter 的 anchorRef：每次现读 store（缝换了 DOM 节点也跟得上）。 */
export const bravaisFilterAnchorRef = {
    get current(): HTMLElement | null {
        return useBravaisUiStore.getState().filterHost;
    },
};

export const setBravaisLinkedKey = (key: string | null) => {
    if (useBravaisUiStore.getState().linkedKey !== key) useBravaisUiStore.setState({ linkedKey: key });
};

export const setBravaisWallHoverKey = (key: string | null) => {
    if (useBravaisUiStore.getState().wallHoverKey !== key) useBravaisUiStore.setState({ wallHoverKey: key });
};

/** 取走移除的翻牌起点：只认这一层记下的。 */
export const takeBravaisRemovalOrigin = (layerKey: string): string | null => {
    const origin = useBravaisUiStore.getState().removalOrigin;
    if (!origin) return null;
    useBravaisUiStore.setState({ removalOrigin: null });
    return origin.layerKey === layerKey ? origin.slotKey : null;
};

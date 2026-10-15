// src/components/app/home/foliumHomePageFocus.ts
// 模组首页页面（FoliumHomePage）的焦点小工具，借自 PR #567 的实验版，改成首尾守卫：页面最前和最后各放一个能 Tab
// 到的守卫元素，页内的 Tab 顺序整个交给浏览器（slot 投影、SVG、closed ShadowRoot、iframe 里的控件都按浏览器自己的
// 序列走），只有焦点落到守卫上（Tab 即将离开页面）时才把它送到另一头。这里给出：守卫该把焦点送到哪一头、从那一头
// 起依次试着聚焦（穿透模组的 open ShadowRoot），以及穿透 ShadowRoot 的当前焦点元素。只读 DOM，不碰 React 状态。

/** 页面首尾守卫元素带的属性；列可聚焦元素时跳过它们。 */
export const HOME_PAGE_FOCUS_GUARD = 'data-folium-focus-guard';

export type HomePageFocusGuard = 'start' | 'end';
export type HomePageFocusEdge = 'first' | 'last';
type FocusTarget = HTMLElement | SVGElement;

/** tabIndex 是 0 却不可聚焦的元素：没有 href 的 a / area（规范给它们的 tabIndex 默认值也是 0）。 */
const UNFOCUSABLE_WITH_TAB_INDEX = 'a:not([href]), area:not([href])';

/** 渲染出来的子元素：影子宿主走它的 ShadowRoot，分到了内容的 slot 走投影进来的元素，其余走自己的子元素。 */
const renderedChildren = (element: Element): Element[] => {
    if (element.shadowRoot) return [...element.shadowRoot.children];
    if (element instanceof HTMLSlotElement) {
        const assigned = element.assignedElements({ flatten: true });
        if (assigned.length > 0) return assigned;
    }
    return [...element.children];
};

const isTabbable = (element: Element): element is FocusTarget => (element instanceof HTMLElement || element instanceof SVGElement)
    && element.tabIndex >= 0
    && !element.matches(':disabled')
    && !element.matches(UNFOCUSABLE_WITH_TAB_INDEX)
    && element.getClientRects().length > 0
    && getComputedStyle(element).visibility === 'visible';

const collectTargets = (elements: readonly Element[]): FocusTarget[] => elements.flatMap(element => {
    if (element.matches(`[inert], [hidden], [${HOME_PAGE_FOCUS_GUARD}]`)) return [];
    return [...(isTabbable(element) ? [element] : []), ...collectTargets(renderedChildren(element))];
});

/**
 * 页面里此刻大致能用 Tab 到达的元素，按渲染顺序：模组 ShadowRoot 里的元素排在宿主的位置上，slot 投影的元素排在
 * slot 的位置上。跳过守卫、inert / hidden 子树、禁用的控件、没有 href 的链接、没有布局盒子或不可见的元素。
 * 它只用来找「从哪一头起聚焦」，不决定页内的 Tab 顺序；closed ShadowRoot、iframe 里的控件看不到，
 * 那时焦点落在离那一头最近的、看得到的元素上。
 */
export const homePageFocusTargets = (root: ParentNode): FocusTarget[] => collectTargets([...root.children]);

/**
 * 焦点落到首 / 尾守卫上时该送到哪一头。从页面里出来的（Tab 越过最后一个、Shift+Tab 越过页头的返回按钮）绕回
 * 另一头；从页面外面进来的（原生首页是 inert 的，只可能是 App 别处的控件）落在离它最近的那一头，与没有守卫时一样。
 * 来源不明（relatedTarget 为 null）时：首守卫按「从外面进来」算——页面里紧挨着它的永远是页头的返回按钮；
 * 尾守卫按「从页面里出来」算——焦点从模组的 iframe 里 Tab 出来时浏览器不给 relatedTarget。
 */
export const resolveHomePageGuardEdge = (guard: HomePageFocusGuard, from: EventTarget | null, page: Node): HomePageFocusEdge => {
    const known = from instanceof Node;
    const inside = known && page.contains(from);
    if (guard === 'start') return inside ? 'last' : 'first';
    return known && !inside ? 'last' : 'first';
};

/**
 * 从页面的一头起依次试着聚焦，直到焦点真的离开守卫（focus() 没生效的元素跳过去）。返回接住焦点的元素，
 * 一个都没接住时返回 null（焦点留在守卫上，下一次 Tab 照常往前走）。
 */
export const focusHomePageEdge = (page: ParentNode, edge: HomePageFocusEdge, guard: Element): FocusTarget | null => {
    const targets = homePageFocusTargets(page);
    if (edge === 'last') targets.reverse();
    const root = guard.getRootNode() as Document | ShadowRoot;
    for (const target of targets) {
        target.focus();
        if (root.activeElement !== guard) return target;
    }
    return null;
};

/** 当前焦点元素；document.activeElement 在每一层 ShadowRoot 边界上都被改成宿主元素，这里一层层钻进去。 */
export const deepActiveElement = (): Element | null => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
};

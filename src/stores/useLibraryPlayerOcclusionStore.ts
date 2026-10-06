import { create } from 'zustand';

// src/stores/useLibraryPlayerOcclusionStore.ts
// 资料库的常驻舞台（stage）此刻是否完全盖住了播放页（B6b）。stage 经契约的 reportPlayerOcclusion 报告，宿主的挂载位
// （library/app/LibrarySuiteStageSlot）代为写入；App 只读 selectLibraryOccludesPlayer 决定要不要卸载 visualizer，
// 不认识任何 suite，也不读 suite 自己的偏好。
//
// 复位不靠 stage 自觉：挂载位每挂一个 stage 就登记一个持有者（owner），卸载、换 suite 时注销。生效值要求「报告来自
// 当前登记的持有者」，所以 stage 卸载后晚到的报告、换 suite 前旧 stage 的报告都不算数；没有 stage（grid / TUI）时
// 没有持有者，永远是 false。报告与登记的先后不限（子组件的 effect 先于挂载位的 effect 执行）。

/** 一次 stage 挂载的身份。挂载位每次挂载（含换 suite）新建一个，只比较引用。 */
export type LibraryPlayerOcclusionOwner = { readonly suiteId: string };

type LibraryPlayerOcclusionState = {
    /** 当前登记着的 stage；null = 没有 stage 挂着。 */
    mountedOwner: LibraryPlayerOcclusionOwner | null;
    /** 最近一次报告来自谁、报的是什么。只有 reportOwner === mountedOwner 时才生效。 */
    reportOwner: LibraryPlayerOcclusionOwner | null;
    reportedOccludes: boolean;
    /** 挂载位登记 stage（顶替之前的持有者）。 */
    mount: (owner: LibraryPlayerOcclusionOwner) => void;
    /** 挂载位注销：只有仍是当前持有者时才清空，旧实例晚一步注销不会清掉新实例。 */
    release: (owner: LibraryPlayerOcclusionOwner) => void;
    /** stage 的报告（经挂载位转交）。值不变时不写 store；当前持有者报过之后，其他持有者的报告被忽略。 */
    report: (owner: LibraryPlayerOcclusionOwner, occludes: boolean) => void;
};

export const useLibraryPlayerOcclusionStore = create<LibraryPlayerOcclusionState>((set, get) => ({
    mountedOwner: null,
    reportOwner: null,
    reportedOccludes: false,
    mount: (owner) => {
        if (get().mountedOwner === owner) return;
        set({ mountedOwner: owner });
    },
    release: (owner) => {
        const state = get();
        if (state.mountedOwner !== owner) return;
        set({
            mountedOwner: null,
            ...(state.reportOwner === owner ? { reportOwner: null, reportedOccludes: false } : {}),
        });
    },
    report: (owner, occludes) => {
        const state = get();
        if (state.reportOwner === owner && state.reportedOccludes === occludes) return;
        // 当前持有者已经报过时，别人（已卸载的旧 stage 晚到的报告）不能顶掉它。
        if (state.reportOwner !== null && state.reportOwner !== owner && state.reportOwner === state.mountedOwner) return;
        set({ reportOwner: owner, reportedOccludes: occludes });
    },
}));

/** 生效值：当前挂着的 stage 报告自己完全遮挡播放页。 */
export const selectLibraryOccludesPlayer = (state: LibraryPlayerOcclusionState) => (
    state.mountedOwner !== null
    && state.reportOwner === state.mountedOwner
    && state.reportedOccludes
);

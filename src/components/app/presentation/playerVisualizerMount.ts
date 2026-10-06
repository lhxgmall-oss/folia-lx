// src/components/app/presentation/playerVisualizerMount.ts
// 播放页 visualizer 什么时候挂载（App 的背景层）。两种情况下画面被完全盖住、visualizer 卸载以免在下面空转：
// - Lattice：进入即卸载，退出动画结束（hasLatticeExited）后才重新挂载；
// - 资料库 stage 报告完全遮挡（B6b，bravais 的实色档）：首页完全显示并且遮挡已经稳定（settled）后才卸载；
//   首页不再显示（回播放页、设置弹窗 / 面板盖上）或 stage 改报 false 时立即重新挂载。
// 这里只认 stage 的报告，不认识任何 suite id，也不读 suite 的偏好。

type PlayerVisualizerMountInput = {
    currentView: string;
    hasLatticeExited: boolean;
    /** buildHomeSurfacePresentation 的 shouldShowHomeSurface：首页正显示着、没有被弹窗 / 面板盖住。 */
    shouldShowHomeSurface: boolean;
    /** 挂着的 stage 报告自己完全遮挡播放页（selectLibraryOccludesPlayer）。 */
    libraryOccludesPlayer: boolean;
    /** 首页实色盖上之后的稳定标记（useLibraryOcclusionSettled）。 */
    hasLibraryOcclusionSettled: boolean;
};

/** visualizer 是否挂载。三项遮挡条件缺一不可，任何一项失效都立即恢复挂载。 */
export const shouldMountPlayerVisualizer = ({
    currentView,
    hasLatticeExited,
    shouldShowHomeSurface,
    libraryOccludesPlayer,
    hasLibraryOcclusionSettled,
}: PlayerVisualizerMountInput) => (
    currentView !== 'lattice'
    && hasLatticeExited
    && !(shouldShowHomeSurface && libraryOccludesPlayer && hasLibraryOcclusionSettled)
);

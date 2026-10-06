import { useEffect, useMemo } from 'react';
import { useLibraryWallLookStore } from '../../../stores/useLibraryWallLookStore';
import { occludesPlayerFor, type BravaisWallLook } from './bravaisLook';

// src/library/suites/bravais/useBravaisWallLook.ts
// stage 读透光偏好（app 层的 useLibraryWallLookStore，设置页与命令面板写它），并按档位向宿主报告遮挡：
// 实色档完全盖住播放页报 true（宿主在首页完全显示后卸载 visualizer），其余报 false（有窗、缝是半透明的）。
// 报告放在 effect 里（提交并绘制之后），实色档的墙面那时已经画好；卸载时不用报 false，宿主自动复位。

export const useBravaisWallLook = (reportPlayerOcclusion: (occludes: boolean) => void): BravaisWallLook => {
    const look = useLibraryWallLookStore(state => state.look);
    const windowsPerBlock = useLibraryWallLookStore(state => state.windowsPerBlock);

    useEffect(() => {
        reportPlayerOcclusion(occludesPlayerFor(look));
    }, [look, reportPlayerOcclusion]);

    return useMemo(() => ({ look, windowsPerBlock }), [look, windowsPerBlock]);
};

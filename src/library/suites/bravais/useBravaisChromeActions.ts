import { useMemo, type MutableRefObject } from 'react';
import { useLibrarySuiteChromeRegistration } from '../../core/bindings/useLibrarySuiteChromeRegistration';
import { getBlockSize, getBlockSlots, type WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_METRICS } from './bravaisConstants';
import { findItemSlotNear, type BravaisDisplay } from './bravaisDisplay';
import { useBravaisSeamStore } from './bravaisSeamLevel';
import { useBravaisUiStore } from './bravaisUiStore';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisChromeActions.ts
// bravais 的外观动作（B2 的 suite-chrome）：缝的三级开口（展开 / 收起成书脊 / 折叠）、在这里裂开缝、定位正在播放。
// 元数据（文案、关键词、执行键）静态声明在 entry.ts 的 chromeActions；这里只注册「此刻能不能做」与「怎么做」，
// 只在 stage 此刻可交互（当前层归 bravais）时注册。isAvailable 在命令面板列命令时现读帧状态与 store，不进 React。

export const BRAVAIS_SUITE_ID = 'bravais';

export const useBravaisChromeActions = ({
    active,
    displayRef,
    frameRef,
    isCollapsed,
    reopenHere,
    focusSlot,
    openList,
}: {
    active: boolean;
    displayRef: MutableRefObject<BravaisDisplay | null>;
    frameRef: MutableRefObject<BravaisFrameState>;
    /** 缝本该张开却被挤到屏外收起了。 */
    isCollapsed: () => boolean;
    reopenHere: () => void;
    focusSlot: (slot: WallSlot, options: { reveal?: boolean }) => void;
    /** B7：打开列表面板。 */
    openList?: () => void;
}) => {
    const handlers = useMemo(() => {
        const level = () => useBravaisSeamStore.getState().level;
        const setLevel = useBravaisSeamStore.getState().setLevel;
        const hasLayer = () => displayRef.current !== null;
        /** 正在播放的那首离缝最近的一份（无限拼贴上有好几份）。 */
        const nowPlayingSlot = () => {
            const display = displayRef.current;
            const key = display?.layer.nowPlayingKey;
            if (!display || !key) return null;
            const { anchorX, center } = frameRef.current;
            return findItemSlotNear(
                display,
                key,
                { x: anchorX ?? center.x, y: center.y },
                getBlockSize(BRAVAIS_METRICS),
                (column, row) => getBlockSlots(column, row, BRAVAIS_METRICS),
            );
        };
        return {
            'seam-full': { isAvailable: () => hasLayer() && level() !== 'full', run: () => setLevel('full') },
            'seam-spine': { isAvailable: () => hasLayer() && level() !== 'spine', run: () => setLevel('spine') },
            'seam-hide': { isAvailable: () => hasLayer() && level() !== 'hidden', run: () => setLevel('hidden') },
            'seam-here': { isAvailable: () => hasLayer() && level() !== 'hidden' && isCollapsed(), run: reopenHere },
            // B7：打开列表（grid 的 toggle-track-list 在 bravais 的对应）；只有支持面板的层、面板还没开时可用。
            list: {
                isAvailable: () => {
                    const layer = displayRef.current?.layer;
                    return Boolean(openList && layer?.entries?.hasPanel && useBravaisUiStore.getState().panelFor !== layer.key);
                },
                run: () => openList?.(),
            },
            'locate-playing': {
                isAvailable: () => nowPlayingSlot() !== null,
                run: () => {
                    const slot = nowPlayingSlot();
                    if (slot) focusSlot(slot, { reveal: true });
                },
            },
        };
    }, [displayRef, focusSlot, frameRef, isCollapsed, openList, reopenHere]);

    useLibrarySuiteChromeRegistration({ suiteId: BRAVAIS_SUITE_ID, isInteractive: active, handlers });
};

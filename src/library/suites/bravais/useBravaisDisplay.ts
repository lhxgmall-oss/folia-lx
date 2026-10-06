import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { planFlip, type FlipOrigin } from '../../../components/wall/flipPlan';
import { nearestSeamBoundaryX } from '../../../components/wall/seamPlan';
import { getViewWorldBounds, type WallView, type WallViewCenter } from '../../../components/wall/wallView';
import { getWallSlot, parseWallSlotKey, type WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_METRICS } from './bravaisConstants';
import {
    createBravaisDisplay,
    diffDisplays,
    findNearestSlot,
    pointOrigin,
    resolveSlotItem,
    toFlipSteps,
    type BravaisDisplay,
    type BravaisFlipStep,
} from './bravaisDisplay';
import type { BravaisLayer } from './bravaisLayer';
import { readBravaisLayout, writeBravaisLayout } from './bravaisLayoutMemory';
import { resolveSeamOpenWidth, useBravaisSeamStore } from './bravaisSeamLevel';
import { takeBravaisPendingOrigin } from './bravaisStageStore';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisDisplay.ts
// 换层的编排（设计稿 §7 转场语法）：store 给出的当前层一变，就决定这是 push / back / 原地替换（首页换页签）还是同一层
// 的数据更新，算出新层的起点 slot、缝锚点与相机去处，对已渲染的 slot 比较前后内容排一次翻牌（wall 的 planFlip），
// 一次 setState 换上新的显示。缝保持张开、只翻缝里的内容（useBravaisSeam）；push 时被点的磁贴是起点磁贴，原地成为
// 新层的第 1 项；back 时相机回到父层离开时的位置，翻牌从缝开始。
// 布局记忆：push 离开一层时、stage 卸载时写 sessionStorage；back 时离开的那一层不写（「完成」刚让宿主忘掉了它）。

/** 翻牌只排视口外扩这么多（世界单位）以内的磁贴。 */
const FLIP_OVERSCAN = 160;

export type BravaisDisplayControls = {
    frameRef: MutableRefObject<BravaisFrameState>;
    view: WallView | null;
    /** 此刻渲染着的 slot（翻牌只比较它们）。 */
    slotsRef: MutableRefObject<readonly WallSlot[]>;
    depth: number;
    setAnchor: (x: number | null) => void;
    planOpening: (center: WallViewCenter, width: number, preferAnchor: boolean) => { anchorX: number | null; center: WallViewCenter };
    isAnchorOnScreen: () => boolean;
    moveTo: (center: WallViewCenter, forceRecull?: boolean) => void;
    tweenTo: (center: WallViewCenter) => void;
    /** 换层时收起聚焦卡、按起点 / 记忆放键盘焦点。 */
    collapseFocusCard: () => void;
    getFocusedSlotKey: () => string | null;
    restoreFocus: (slotKey: string | null) => void;
};

const slotFromKey = (key: string | null): WallSlot | null => {
    const address = key ? parseWallSlotKey(key) : null;
    return address ? getWallSlot(address.column, address.row, address.slotIndex, BRAVAIS_METRICS) : null;
};

/** 同一层的数据更新：还在翻的磁贴（目标没变、这次又没安排它）保留原来的安排，不被打断。 */
const mergeFlipSteps = (
    previous: BravaisDisplay,
    next: BravaisDisplay,
    fresh: ReadonlyMap<string, BravaisFlipStep>,
    slots: readonly WallSlot[],
): ReadonlyMap<string, BravaisFlipStep> => {
    if (previous.flips.size === 0) return fresh;
    const merged = new Map(fresh);
    for (const slot of slots) {
        if (merged.has(slot.key)) continue;
        const step = previous.flips.get(slot.key);
        if (step && step.to === (resolveSlotItem(next, slot)?.key ?? null)) merged.set(slot.key, step);
    }
    return merged;
};

export const useBravaisDisplay = (layer: BravaisLayer | null, controls: BravaisDisplayControls) => {
    const [display, setDisplay] = useState<BravaisDisplay | null>(null);
    const displayRef = useRef<BravaisDisplay | null>(null);
    const displayedDepthRef = useRef(controls.depth);
    const flipTokenRef = useRef(0);
    const latestControls = useRef(controls);
    latestControls.current = controls;

    const commit = useCallback((next: BravaisDisplay, depth: number) => {
        displayRef.current = next;
        displayedDepthRef.current = depth;
        setDisplay(next);
    }, []);

    /** 离开一层时记下它的相机、锚点、起点与键盘焦点。 */
    const remember = useCallback((current: BravaisDisplay) => {
        const { frameRef, getFocusedSlotKey } = latestControls.current;
        writeBravaisLayout(current.layer.sessionKey, {
            center: { ...frameRef.current.center },
            anchorX: frameRef.current.anchorX,
            startSlotKey: current.startSlotKey,
            focusSlotKey: getFocusedSlotKey(),
        });
    }, []);

    const planFlipFor = useCallback((before: BravaisDisplay | null, after: BravaisDisplay, origin: FlipOrigin) => {
        const { frameRef, slotsRef } = latestControls.current;
        const { view, center, openWidth } = frameRef.current;
        if (!view) return null;
        flipTokenRef.current += 1;
        const plan = planFlip({
            changes: diffDisplays(before, after, slotsRef.current),
            origin,
            visible: getViewWorldBounds(center, view, { seamWidth: openWidth, overscan: FLIP_OVERSCAN }),
            metrics: BRAVAIS_METRICS,
        });
        return toFlipSteps(flipTokenRef.current, plan);
    }, []);

    useLayoutEffect(() => {
        const controlsNow = latestControls.current;
        const { frameRef, slotsRef } = controlsNow;
        const previous = displayRef.current;
        if (!layer || !controls.view) return;
        if (previous && previous.layer === layer) return;
        const depth = controlsNow.depth;
        const level = useBravaisSeamStore.getState().level;
        const width = resolveSeamOpenWidth(layer.surface, level);
        const seamPoint = () => ({ x: frameRef.current.anchorX ?? frameRef.current.center.x, y: frameRef.current.center.y });
        const nearestToSeam = () => findNearestSlot(slotsRef.current, seamPoint())?.key ?? null;

        // 第一次（stage 挂载）：按记忆摆好相机与锚点，直接画出当前层，不跑翻牌。
        if (!previous) {
            const memory = readBravaisLayout(layer.sessionKey);
            let center = memory?.center ?? frameRef.current.center;
            frameRef.current.anchorX = memory?.anchorX ?? nearestSeamBoundaryX(center.x, BRAVAIS_METRICS);
            if (width > 0) center = controlsNow.planOpening(center, width, true).center;
            controlsNow.setAnchor(frameRef.current.anchorX);
            controlsNow.moveTo(center, true);
            commit(createBravaisDisplay(layer, memory?.startSlotKey ?? null), depth);
            return;
        }

        // 同一层的数据更新（加载完成、补页、正在播放换了）：只翻内容变了的 slot，从起点磁贴或缝开始。
        if (previous.layer.key === layer.key) {
            const draft = createBravaisDisplay(layer, previous.startSlotKey);
            const start = slotFromKey(previous.startSlotKey);
            const fresh = planFlipFor(previous, draft, pointOrigin(start ? { x: start.centerX, y: start.centerY } : seamPoint()));
            // 整墙有内容在翻：聚焦卡收起（它所在的块也可能在翻）。
            if (fresh && fresh.size > 0) controlsNow.collapseFocusCard();
            const flips = mergeFlipSteps(previous, draft, fresh ?? new Map(), slotsRef.current);
            commit({ ...draft, flips, flipToken: flipTokenRef.current }, displayedDepthRef.current);
            return;
        }

        // 换层。
        const kind = depth > displayedDepthRef.current ? 'push' : depth < displayedDepthRef.current ? 'back' : 'replace';
        const hadKeyboardFocus = controlsNow.getFocusedSlotKey() !== null;
        controlsNow.collapseFocusCard();
        const pending = takeBravaisPendingOrigin(previous.layer.key);
        if (kind !== 'back') remember(previous);

        let center = frameRef.current.center;
        let startSlotKey: string | null;
        let origin: FlipOrigin;
        let focusKey: string | null = null;
        if (kind === 'back') {
            const memory = readBravaisLayout(layer.sessionKey);
            center = memory?.center ?? center;
            if (memory?.anchorX !== undefined && memory.anchorX !== null) frameRef.current.anchorX = memory.anchorX;
            startSlotKey = memory?.startSlotKey ?? nearestToSeam();
            origin = pointOrigin(seamPoint());
            focusKey = memory?.focusSlotKey ?? null;
        } else {
            const memory = pending ? null : readBravaisLayout(layer.sessionKey);
            startSlotKey = pending?.slotKey ?? memory?.startSlotKey ?? nearestToSeam();
            const start = slotFromKey(startSlotKey);
            origin = pointOrigin(start ? { x: start.centerX, y: start.centerY } : seamPoint());
            if (hadKeyboardFocus) focusKey = startSlotKey;
        }
        // 缝保持张开：可见就沿用它的块边界，新开口放不下时相机最小让位（完全收起时不为看不见的缝平移相机）。
        if (width > 0) {
            const preferAnchor = kind === 'back' || controlsNow.isAnchorOnScreen();
            const plan = controlsNow.planOpening(center, width, preferAnchor);
            frameRef.current.anchorX = plan.anchorX;
            center = plan.center;
        }
        controlsNow.setAnchor(frameRef.current.anchorX);
        const draft = createBravaisDisplay(layer, startSlotKey);
        const flips = planFlipFor(previous, draft, origin);
        commit({ ...draft, flips: flips ?? draft.flips, flipToken: flipTokenRef.current }, depth);
        controlsNow.tweenTo(center);
        controlsNow.restoreFocus(focusKey);
    }, [commit, controls.view, layer, planFlipFor, remember]);

    // stage 卸载（离开首页约 350ms 后）：记下当前层，回来时按它恢复。
    useEffect(() => () => {
        if (displayRef.current) remember(displayRef.current);
    }, [remember]);

    return { display, displayRef };
};

import { animate } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { Bounds } from '../../../components/wall/layout';
import type { LatticeCamera } from '../../../components/wall/useWallCameraPan';
import { useWallPointerPan } from '../../../components/wall/useWallPointerPan';
import {
    cameraFromViewCenter,
    getViewWorldBounds,
    viewCenterFromCamera,
    type WallView,
    type WallViewCenter,
} from '../../../components/wall/wallView';
import { BRAVAIS_CAMERA_TWEEN_S, BRAVAIS_CULL_EDGE_MARGIN, BRAVAIS_OVERSCAN } from './bravaisConstants';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisCamera.ts
// 相机：真源是视图中心（缝基准线下的世界点，B5 的约定），存在帧状态里；拖动 / 滚轮 / 惯性复用 wall 的
// useWallPointerPan（它说的是 Lattice 的平移相机，这里双向换算）。每次移动只写 DOM；裁剪范围（React state）
// 只在快到已渲染范围的边缘时才更新一次，补间开始时预留目的地的范围（与 Lattice 的 reserveBounds 同理）。

// 一次补间最多预留几屏的范围，再大就只留目的地（渲染上限装不下）。
const MAX_RESERVED_VIEWPORTS = 3;

const area = (bounds: Bounds) => (bounds.right - bounds.left) * (bounds.bottom - bounds.top);

/** 当前可见的世界范围（缝张开时两半各让出半个开口，左右再放宽一个开口宽）。 */
export const getVisibleWorldBounds = (state: BravaisFrameState): Bounds | null => (
    state.view ? getViewWorldBounds(state.center, state.view, { seamWidth: state.openWidth }) : null
);

/** 可见范围离已裁剪范围的边缘还剩不到一截 overscan 时才需要重新裁剪。 */
export const needsRecull = (visible: Bounds, culled: Bounds | null) => {
    if (!culled) return true;
    const padding = BRAVAIS_OVERSCAN - BRAVAIS_CULL_EDGE_MARGIN;
    return visible.left < culled.left - padding
        || visible.right > culled.right + padding
        || visible.top < culled.top - padding
        || visible.bottom > culled.bottom + padding;
};

export const useBravaisCamera = ({
    frameRef,
    renderFrame,
    fieldRef,
    reducedMotion,
}: {
    frameRef: MutableRefObject<BravaisFrameState>;
    renderFrame: () => void;
    fieldRef: RefObject<HTMLDivElement | null>;
    reducedMotion: boolean;
}) => {
    // 已裁剪（渲染了 slot）的可见范围；墙渲染它外扩 overscan 的 slot。
    const [bounds, setBounds] = useState<Bounds | null>(null);
    const boundsRef = useRef<Bounds | null>(null);
    boundsRef.current = bounds;
    const cullFrameRef = useRef<number | null>(null);
    const animationRef = useRef<{ stop: () => void } | null>(null);
    // useWallPointerPan 读写的是 Lattice 形状的平移相机：每次移动都同步它。
    const cameraRef = useRef<LatticeCamera>({ x: 0, y: 0, scale: 1 });
    const viewportRef = useRef({ width: 1, height: 1 });

    const syncPointerCamera = useCallback(() => {
        const { view, center } = frameRef.current;
        if (!view) return;
        cameraRef.current = cameraFromViewCenter(center, view);
        viewportRef.current = { width: view.width, height: view.height };
    }, [frameRef]);

    /** 把裁剪范围换成此刻的可见范围（合并到下一帧，一帧最多一次 setState）。 */
    const scheduleRecull = useCallback(() => {
        if (cullFrameRef.current !== null) return;
        cullFrameRef.current = requestAnimationFrame(() => {
            cullFrameRef.current = null;
            const visible = getVisibleWorldBounds(frameRef.current);
            if (visible) setBounds(visible);
        });
    }, [frameRef]);

    /** 移到一个视图中心：写 DOM；快到裁剪边缘时（或调用方要求时）重新裁剪。 */
    const moveTo = useCallback((center: WallViewCenter, forceRecull = false) => {
        frameRef.current.center = center;
        syncPointerCamera();
        renderFrame();
        const visible = getVisibleWorldBounds(frameRef.current);
        if (visible && (forceRecull || needsRecull(visible, boundsRef.current))) scheduleRecull();
    }, [frameRef, renderFrame, scheduleRecull, syncPointerCamera]);

    const stopCamera = useCallback(() => {
        animationRef.current?.stop();
        animationRef.current = null;
    }, []);

    /** 补间到一个视图中心；开始时把目的地并进裁剪范围，免得飞行途中墙是空的。 */
    const tweenTo = useCallback((target: WallViewCenter, duration = BRAVAIS_CAMERA_TWEEN_S) => {
        stopCamera();
        const from = { ...frameRef.current.center };
        if (Math.abs(target.x - from.x) < 0.5 && Math.abs(target.y - from.y) < 0.5) return;
        const view = frameRef.current.view;
        if (view) {
            const destination = getViewWorldBounds(target, view, { seamWidth: frameRef.current.openWidth });
            setBounds(current => {
                if (!current) return destination;
                const merged = {
                    left: Math.min(current.left, destination.left),
                    right: Math.max(current.right, destination.right),
                    top: Math.min(current.top, destination.top),
                    bottom: Math.max(current.bottom, destination.bottom),
                };
                return area(merged) > area(destination) * MAX_RESERVED_VIEWPORTS ? destination : merged;
            });
        }
        if (reducedMotion || duration <= 0) {
            moveTo(target, true);
            return;
        }
        animationRef.current = animate(0, 1, {
            duration,
            ease: [0.22, 1, 0.36, 1],
            onUpdate: progress => {
                frameRef.current.center = {
                    x: from.x + (target.x - from.x) * progress,
                    y: from.y + (target.y - from.y) * progress,
                };
                syncPointerCamera();
                renderFrame();
            },
            onComplete: () => {
                animationRef.current = null;
                moveTo(target, true);
            },
        });
    }, [frameRef, moveTo, reducedMotion, renderFrame, stopCamera, syncPointerCamera]);

    // 拖动与滚轮：wall 的 hook 交回平移相机，换算成视图中心再走同一条 moveTo。
    const applyCamera = useCallback((next: LatticeCamera, updateBounds?: boolean) => {
        const view = frameRef.current.view;
        if (!view) return;
        moveTo(viewCenterFromCamera(next, view), Boolean(updateBounds));
    }, [frameRef, moveTo]);
    const getWorldBounds = useCallback((camera: LatticeCamera) => {
        const view = frameRef.current.view;
        if (!view) return { left: 0, right: 0, top: 0, bottom: 0 };
        return getViewWorldBounds(viewCenterFromCamera(camera, view), view, { seamWidth: frameRef.current.openWidth });
    }, [frameRef]);
    const pointer = useWallPointerPan({
        applyCamera,
        animationRef,
        stopPan: stopCamera,
        containerRef: fieldRef,
        reducedMotion,
        overscan: BRAVAIS_OVERSCAN,
        bounds: bounds ?? { left: 0, right: 0, top: 0, bottom: 0 },
        cameraRef,
        getWorldBounds,
        viewportRef,
    });

    useEffect(() => () => {
        if (cullFrameRef.current !== null) cancelAnimationFrame(cullFrameRef.current);
        animationRef.current?.stop();
    }, []);

    return { bounds, moveTo, tweenTo, stopCamera, syncPointerCamera, pointer };
};

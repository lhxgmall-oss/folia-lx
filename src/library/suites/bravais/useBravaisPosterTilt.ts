import { animate } from 'framer-motion';
import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { BRAVAIS_POSTER_TILT_DEG, BRAVAIS_POSTER_TILT_TWEEN_S } from './bravaisConstants';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisPosterTilt.ts
// 歌手海报静止时墙面倾斜（BRAVAIS_POSTER_TILT_DEG），像一张斜贴在海报旁边的拼贴；一开始操作墙（按下指针、滚轮、
// 方向键这类按键）就补间回正，之后这一层不再倾斜，换层回来再算一次。倾斜只是两个世界层 transform 前面多一段旋转
// （bravaisFrame 的 withTilt），每帧写帧状态再 renderFrame，不经过 React。
// 拖动、键盘移焦点、聚焦卡让位、裁剪这些都按不倾斜的墙算：回正之后它们才开始，所以不用换算倾斜后的坐标。
// 倾斜中裁剪仍按不倾斜的可见范围：视口角上转进来的那一块落在 BRAVAIS_OVERSCAN 的多渲染范围里。
// 降低动态效果（lattice）时不倾斜：静止的斜墙本身就是一种需要回正的状态。

/** 操作墙的按键（会移动相机或焦点的那些）；海报里的按钮、输入框上的按键不算。 */
const WALL_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Enter']);

export const useBravaisPosterTilt = ({
    frameRef,
    renderFrame,
    checkCull,
    rootRef,
    seamRef,
    pinned,
    layerKey,
    reducedMotion,
}: {
    frameRef: MutableRefObject<BravaisFrameState>;
    renderFrame: () => void;
    checkCull: (force?: boolean) => void;
    rootRef: RefObject<HTMLElement | null>;
    seamRef: RefObject<HTMLDivElement | null>;
    /** 此刻是钉在左边的歌手海报。 */
    pinned: boolean;
    /** 换层后重新倾斜。 */
    layerKey: string | null;
    reducedMotion: boolean;
}) => {
    const [settledFor, setSettledFor] = useState<string | null>(null);
    const tilted = pinned && !reducedMotion && layerKey !== null && settledFor !== layerKey;

    // 一开始操作墙就回正（只看墙，不看海报里的控件）。
    useEffect(() => {
        const root = rootRef.current;
        if (!tilted || !root) return undefined;
        const fromWall = (target: EventTarget | null) => !(target instanceof Node && seamRef.current?.contains(target));
        const settle = () => setSettledFor(layerKey);
        const onPointerDown = (event: PointerEvent) => { if (fromWall(event.target)) settle(); };
        const onWheel = (event: WheelEvent) => { if (fromWall(event.target)) settle(); };
        const onKeyDown = (event: KeyboardEvent) => { if (WALL_KEYS.has(event.key) && fromWall(event.target)) settle(); };
        root.addEventListener('pointerdown', onPointerDown, true);
        root.addEventListener('wheel', onWheel, { capture: true, passive: true });
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            root.removeEventListener('pointerdown', onPointerDown, true);
            root.removeEventListener('wheel', onWheel, true);
            window.removeEventListener('keydown', onKeyDown, true);
        };
    }, [layerKey, rootRef, seamRef, tilted]);

    const animationRef = useRef<{ stop: () => void } | null>(null);
    useEffect(() => {
        const to = tilted ? BRAVAIS_POSTER_TILT_DEG : 0;
        const from = frameRef.current.tiltDeg;
        animationRef.current?.stop();
        animationRef.current = null;
        if (Math.abs(to - from) < 0.01) return;
        if (reducedMotion) {
            frameRef.current.tiltDeg = to;
            renderFrame();
            checkCull(true);
            return;
        }
        animationRef.current = animate(from, to, {
            duration: BRAVAIS_POSTER_TILT_TWEEN_S,
            ease: [0.22, 1, 0.36, 1],
            onUpdate: value => {
                frameRef.current.tiltDeg = value;
                renderFrame();
            },
            onComplete: () => {
                animationRef.current = null;
                checkCull(true);
            },
        });
    }, [checkCull, frameRef, reducedMotion, renderFrame, tilted]);
    useEffect(() => () => animationRef.current?.stop(), []);

    return { tilted };
};

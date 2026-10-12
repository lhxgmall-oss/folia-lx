import { animate } from 'framer-motion';
import { useEffect, useRef, type MutableRefObject } from 'react';
import { BRAVAIS_POSTER_TILT_DEG, BRAVAIS_POSTER_TILT_TWEEN_S } from './bravaisConstants';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisPosterTilt.ts
// 歌手海报在场时墙面倾斜（BRAVAIS_POSTER_TILT_DEG），像一张斜贴在海报旁边的拼贴；海报收起（过滤、面板、表单、书脊、
// 折叠、换到别的层）时补间回正。倾斜只是两个世界层 transform 前面多一段旋转（bravaisFrame 的 withTilt），每帧写帧状态
// 再 renderFrame，不经过 React。
// 倾斜着照样能拖、能滚：拖动与滚轮的位移在 useBravaisCamera 里按倾斜角转回墙的坐标（手指往哪拖，墙就往哪走）。
// 裁剪仍按不倾斜的可见范围：视口角上转进来的那一块落在 BRAVAIS_OVERSCAN 的多渲染范围里。
// 降低动态效果（lattice）时不倾斜。

export const useBravaisPosterTilt = ({
    frameRef,
    renderFrame,
    checkCull,
    syncPointerCamera,
    pinned,
    reducedMotion,
}: {
    frameRef: MutableRefObject<BravaisFrameState>;
    renderFrame: () => void;
    checkCull: (force?: boolean) => void;
    /** 倾斜角变了：拖动 / 滚轮那一侧的平移相机按新角度重新换算（useBravaisCamera）。 */
    syncPointerCamera: () => void;
    /** 此刻是钉在左边的歌手海报。 */
    pinned: boolean;
    reducedMotion: boolean;
}) => {
    const tilted = pinned && !reducedMotion;
    const animationRef = useRef<{ stop: () => void } | null>(null);
    useEffect(() => {
        const to = tilted ? BRAVAIS_POSTER_TILT_DEG : 0;
        const from = frameRef.current.tiltDeg;
        animationRef.current?.stop();
        animationRef.current = null;
        if (Math.abs(to - from) < 0.01) return;
        if (reducedMotion) {
            frameRef.current.tiltDeg = to;
            syncPointerCamera();
            renderFrame();
            checkCull(true);
            return;
        }
        animationRef.current = animate(from, to, {
            duration: BRAVAIS_POSTER_TILT_TWEEN_S,
            ease: [0.22, 1, 0.36, 1],
            onUpdate: value => {
                frameRef.current.tiltDeg = value;
                syncPointerCamera();
                renderFrame();
            },
            onComplete: () => {
                animationRef.current = null;
                checkCull(true);
            },
        });
    }, [checkCull, frameRef, reducedMotion, renderFrame, syncPointerCamera, tilted]);
    useEffect(() => () => animationRef.current?.stop(), []);

    return { tilted };
};

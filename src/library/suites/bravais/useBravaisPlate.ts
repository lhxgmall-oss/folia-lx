import { useLayoutEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import type { WallSlot } from '../../../components/wall/wallSlots';
import { countRender } from '../../../dev/renderCount';
import type { BravaisDisplay } from './bravaisDisplay';
import type { BravaisFrame } from './bravaisFrame';
import {
    buildPlateMaskLayer,
    collectPlateHoles,
    computePlateMaskStyle,
    EMPTY_PLATE_MASK,
    plateMaskImage,
    type PlateMaskGeometry,
    type PlateRect,
} from './bravaisPlateMask';
import { useBravaisLivePlate } from './useBravaisLivePlate';
import type { BravaisFrameWriter } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisPlate.ts
// 透光档的实色底板（设计稿 §11）：全屏固定、不透明（墙色）、不 blur 的一层，遮罩只在窗位挖洞。
// - 路径（两半墙各一张 SVG 遮罩图）只在挖洞的矩形集合变了时重建：可见块集合（裁剪范围）、窗集合（换档 / 换窗数 /
//   翻牌开关窗）、缝锚点（两半怎么分）、聚焦卡让位落定。重建计数记在 countRender('BravaisPlateMask')，用例据此
//   检查拖动只改位置不重建。
// - 每帧（相机拖动 / 补间、缝开合）只在 renderFrame 末尾写 mask-position / mask-size，不经过 React。
// - 聚焦卡让位期间交给局部底板（useBravaisLivePlate）。

type PlateWritten = { position: string; size: string };

export const useBravaisPlate = ({
    enabled,
    slots,
    display,
    expandedSlotKey,
    reflow,
    anchorX,
    reducedMotion,
    fieldRef,
    renderFrame,
    afterFrameRef,
}: {
    /** 透明档才挂底板；实色档 stage 根节点自己画墙面。 */
    enabled: boolean;
    slots: readonly WallSlot[];
    display: BravaisDisplay | null;
    expandedSlotKey: string | null;
    reflow: ReadonlyMap<string, PlateRect>;
    anchorX: number | null;
    reducedMotion: boolean;
    fieldRef: RefObject<HTMLElement | null>;
    renderFrame: () => void;
    afterFrameRef: MutableRefObject<BravaisFrameWriter | null>;
}) => {
    const plateRef = useRef<HTMLDivElement>(null);
    const live = useBravaisLivePlate({ enabled, expandedSlotKey, reducedMotion, slots, display, anchorX, fieldRef, renderFrame });
    const { liveBlockKey, writeLive } = live;

    // 挖洞的矩形 → 两半的遮罩层；路径没变就沿用上一份（同一个 data URL，浏览器不重新解码）。
    const geometryRef = useRef<PlateMaskGeometry>(EMPTY_PLATE_MASK);
    const geometry = useMemo<PlateMaskGeometry>(() => {
        if (!enabled) return EMPTY_PLATE_MASK;
        const holes = collectPlateHoles({ slots, display, expandedSlotKey, reflow, anchorX, liveBlockKey });
        const previous = geometryRef.current;
        const left = buildPlateMaskLayer(holes.left, previous.left);
        const right = buildPlateMaskLayer(holes.right, previous.right);
        return left === previous.left && right === previous.right ? previous : { left, right };
    }, [anchorX, display, enabled, expandedSlotKey, liveBlockKey, reflow, slots]);

    const writtenRef = useRef<PlateWritten>({ position: '', size: '' });
    // 遮罩图换了：写 mask-image，再按此刻的帧写一次位置。
    useLayoutEffect(() => {
        geometryRef.current = geometry;
        const element = plateRef.current;
        if (!element) return;
        countRender('BravaisPlateMask');
        element.style.maskImage = plateMaskImage(geometry);
        element.dataset.bravaisPlateHoles = String((geometry.left ? 1 : 0) + (geometry.right ? 1 : 0));
        writtenRef.current = { position: '', size: '' };
        renderFrame();
    }, [enabled, geometry, renderFrame]);

    // 每帧的写入者：主底板的遮罩位置，加上让位期间的局部底板。
    useLayoutEffect(() => {
        if (!enabled) return undefined;
        const writer = (frame: BravaisFrame) => {
            const element = plateRef.current;
            if (element) {
                const style = computePlateMaskStyle(frame, geometryRef.current);
                const written = writtenRef.current;
                if (written.position !== style.position) element.style.maskPosition = written.position = style.position;
                if (written.size !== style.size) element.style.maskSize = written.size = style.size;
            }
            writeLive(frame);
        };
        afterFrameRef.current = writer;
        renderFrame();
        return () => {
            if (afterFrameRef.current === writer) afterFrameRef.current = null;
        };
    }, [afterFrameRef, enabled, renderFrame, writeLive]);

    return { plateRef, livePlateRef: live.livePlateRef, liveBlockKey };
};

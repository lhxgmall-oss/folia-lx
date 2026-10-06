import { animate } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { blockSeamPlan, getSeamGeometry } from '../../../components/wall/seamPlan';
import type { WallViewCenter } from '../../../components/wall/wallView';
import {
    BRAVAIS_METRICS,
    BRAVAIS_SEAM_FLIP_IN_MS,
    BRAVAIS_SEAM_FLIP_OUT_MS,
    BRAVAIS_SEAM_TWEEN_S,
} from './bravaisConstants';
import type { BravaisLayer } from './bravaisLayer';
import {
    resolveSeamOpenWidth,
    resolveSeamVariant,
    seamVariantWidth,
    useBravaisSeamStore,
    type BravaisSeamVariant,
} from './bravaisSeamLevel';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisSeam.ts
// 缝（设计稿 §5）：锚点（块边界的世界 x，React state——墙按它分左右两半）、开口宽度的补间（只写帧状态）、
// 缝里渲染的那套内容。换层、换等级时内容原地翻转：转到 90° 才换成新内容与新的排版宽度（翻转不重排），所以
// 「此刻渲染的内容」是单独的 state，只在换的那一刻 setState 一次。开口变宽或恢复时，锚点还在屏内就沿用它的
// 块边界、相机只做最小让位；不在屏内就在当前视口里另取最近的块边界（B5 的 blockSeamPlan）。

export type BravaisRenderedSeam = { variant: BravaisSeamVariant; layer: BravaisLayer | null };

const flipTransform = (degrees: number) => `perspective(1400px) rotateY(${degrees}deg)`;

export const useBravaisSeam = ({
    frameRef,
    renderFrame,
    layer,
    contentRef,
    reducedMotion,
    tweenCamera,
}: {
    frameRef: MutableRefObject<BravaisFrameState>;
    renderFrame: () => void;
    layer: BravaisLayer | null;
    contentRef: RefObject<HTMLDivElement | null>;
    reducedMotion: boolean;
    tweenCamera: (center: WallViewCenter) => void;
}) => {
    const level = useBravaisSeamStore(state => state.level);
    const [anchorX, setAnchorState] = useState<number | null>(null);
    const targetWidth = layer ? resolveSeamOpenWidth(layer.surface, level) : 0;
    const targetVariant: BravaisSeamVariant = layer ? resolveSeamVariant(layer.surface, level) : 'none';
    const [rendered, setRendered] = useState<BravaisRenderedSeam>({ variant: targetVariant, layer });
    const widthAnimationRef = useRef<{ stop: () => void } | null>(null);

    const setAnchor = useCallback((x: number | null) => {
        frameRef.current.anchorX = x;
        setAnchorState(x);
        renderFrame();
    }, [frameRef, renderFrame]);

    /** 缝锚点此刻在不在屏内（在就沿用它的块边界）。 */
    const isAnchorOnScreen = useCallback(() => {
        const { anchorX: x, view, center } = frameRef.current;
        if (x === null || !view) return false;
        const geometry = getSeamGeometry({ anchorX: x, cameraX: center.x, openWidth: 1, view });
        return geometry.screenX > 0 && geometry.screenX < view.width;
    }, [frameRef]);

    /** 要张开 `width` 的缝：选块边界、算相机的最小让位（相对 `center`，返回让位后的视图中心）。 */
    const planOpening = useCallback((center: WallViewCenter, width: number, preferAnchor: boolean) => {
        const { view, anchorX: current } = frameRef.current;
        if (!view) return { anchorX: current, center };
        const plan = blockSeamPlan({
            cameraX: center.x,
            openWidth: width,
            view,
            metrics: BRAVAIS_METRICS,
            preferX: preferAnchor && current !== null ? current : undefined,
        });
        return { anchorX: plan.x, center: { x: plan.cameraX, y: center.y } };
    }, [frameRef]);

    /** 开口补间到目标宽度（每帧只写帧状态与 DOM）。 */
    const tweenWidth = useCallback((to: number, from = frameRef.current.openWidth) => {
        widthAnimationRef.current?.stop();
        if (reducedMotion || Math.abs(to - from) < 0.5) {
            widthAnimationRef.current = null;
            frameRef.current.openWidth = to;
            renderFrame();
            return;
        }
        frameRef.current.openWidth = from;
        widthAnimationRef.current = animate(from, to, {
            duration: BRAVAIS_SEAM_TWEEN_S,
            ease: [0.65, 0, 0.35, 1],
            onUpdate: value => {
                frameRef.current.openWidth = value;
                renderFrame();
            },
            onComplete: () => { widthAnimationRef.current = null; },
        });
    }, [frameRef, reducedMotion, renderFrame]);

    // 目标宽度变了（换层、换等级）就补间过去；折叠等级也写进帧状态（悬浮按钮常驻）。
    const hasLayer = Boolean(layer);
    useEffect(() => {
        frameRef.current.hidden = hasLayer && level === 'hidden';
        tweenWidth(targetWidth);
    }, [frameRef, hasLayer, level, targetWidth, tweenWidth]);

    // 换等级（不是换层）且要张开：锚点在屏内就沿用、相机最小让位；不在屏内就另取一条块边界。
    const previousLevelRef = useRef(level);
    useEffect(() => {
        if (previousLevelRef.current === level) return;
        previousLevelRef.current = level;
        if (!layer || targetWidth <= 0) return;
        const plan = planOpening(frameRef.current.center, targetWidth, isAnchorOnScreen());
        if (plan.anchorX !== frameRef.current.anchorX) setAnchor(plan.anchorX);
        tweenCamera(plan.center);
    }, [frameRef, isAnchorOnScreen, layer, level, planOpening, setAnchor, targetWidth, tweenCamera]);

    // 缝里的内容：换层或换形态时翻转（转到 90° 换内容与排版宽度），同一层的数据更新就地刷新（渲染时取最新的层）。
    const renderedLayer = rendered.layer && layer && rendered.layer.key === layer.key ? layer : rendered.layer;
    const renderedKey = `${rendered.variant}|${rendered.layer?.key ?? ''}`;
    const targetKey = `${targetVariant}|${layer?.key ?? ''}`;
    const latestTargetRef = useRef({ layer, targetVariant });
    latestTargetRef.current = { layer, targetVariant };
    useLayoutEffect(() => {
        if (renderedKey === targetKey) return;
        const element = contentRef.current;
        const swap = () => {
            const next = latestTargetRef.current;
            setRendered({ variant: next.targetVariant, layer: next.layer });
        };
        // 折叠与展开之间、或降低动效时不翻（原型：进出 hidden 直接换）。
        if (!element || reducedMotion || renderedKey.startsWith('none|') || targetKey.startsWith('none|')) {
            swap();
            return;
        }
        let swapped = false;
        const out = element.animate([{ transform: flipTransform(0) }, { transform: flipTransform(90) }], {
            duration: BRAVAIS_SEAM_FLIP_OUT_MS,
            easing: 'ease-in',
            fill: 'forwards',
        });
        out.onfinish = () => {
            swapped = true;
            swap();
            out.cancel();
            // 转回来的这一段不随 effect 清理取消：换内容本身就会让这个 effect 重跑。
            element.animate([{ transform: flipTransform(-90) }, { transform: flipTransform(0) }], {
                duration: BRAVAIS_SEAM_FLIP_IN_MS,
                easing: 'cubic-bezier(.2,.7,.25,1)',
            });
        };
        return () => {
            if (!swapped) out.cancel();
        };
    }, [contentRef, reducedMotion, renderedKey, targetKey]);

    // 排版宽度跟着「此刻渲染的那套内容」走，不跟目标宽度走。
    useLayoutEffect(() => {
        frameRef.current.contentWidth = seamVariantWidth(rendered.variant);
        renderFrame();
    }, [frameRef, renderFrame, rendered.variant]);

    useEffect(() => () => widthAnimationRef.current?.stop(), []);

    /** 自动出屏收起后，在当前视口里裂开一道新缝（不拉回原锚点，设计稿 §5）。 */
    const reopenHere = useCallback(() => {
        if (!layer || targetWidth <= 0) return;
        const plan = planOpening(frameRef.current.center, targetWidth, false);
        setAnchor(plan.anchorX);
        tweenWidth(targetWidth, 0);
        tweenCamera(plan.center);
    }, [frameRef, layer, planOpening, setAnchor, targetWidth, tweenCamera, tweenWidth]);

    /** 此刻缝本该张开却被挤到屏外收起了（边缘标签在场）。 */
    const isCollapsed = useCallback(() => {
        const { anchorX: x, view, center, openWidth } = frameRef.current;
        if (x === null || !view || targetWidth <= 0) return false;
        return getSeamGeometry({ anchorX: x, cameraX: center.x, openWidth: Math.max(openWidth, targetWidth), view }).collapsed;
    }, [frameRef, targetWidth]);

    return { level, anchorX, setAnchor, targetWidth, rendered: { variant: rendered.variant, layer: renderedLayer }, planOpening, isAnchorOnScreen, reopenHere, isCollapsed };
};

import { getSeamGeometry, getSeamSplitOffsets, nearestSeamBoundaryX } from '../../../components/wall/seamPlan';
import { cameraFromViewCenter, getViewLineX, type WallView, type WallViewCenter } from '../../../components/wall/wallView';
import { BRAVAIS_METRICS, BRAVAIS_SEAM_POSTER_WALL_GAP_PX } from './bravaisConstants';

// src/library/suites/bravais/bravaisFrame.ts
// 每一帧要写到 DOM 上的几何（纯计算）：墙的左右两半各自的 transform、缝的屏幕位置与宽度、缝内容的透明度、
// 边缘标签在不在、在哪一侧。缝开在块边界上，没有磁贴跨过它，所以墙按锚点分成左右两个世界层，各自平移让出
// 半个开口（加半个 GAP），不需要裁剪。stage 在相机移动、缝开合时调用它，只写 transform / 尺寸，不经过 React。

export type BravaisFrameInput = {
    center: WallViewCenter;
    view: WallView;
    /** 缝锚点的世界 x；没有层时为 null（墙合拢，没有缝）。 */
    anchorX: number | null;
    /** 此刻（动画中）的目标开口宽度，屏幕 px。 */
    openWidth: number;
    /** 缝里此刻渲染的那套内容的排版宽度（翻转不重排：不跟目标宽度走）。 */
    contentWidth: number;
    /** 折叠等级（hidden）：标签换成悬浮按钮，常驻。 */
    hidden: boolean;
    /** 歌手海报：缝钉在视口左边、宽 openWidth，墙不分两半（整面在它右边，相机负责让出位置）。 */
    pinned?: boolean;
    /** 墙面此刻的倾斜角（度；海报静止时转过去，见 BRAVAIS_POSTER_TILT_DEG）。 */
    tiltDeg?: number;
};

export type BravaisFrame = {
    left: { x: number; y: number };
    right: { x: number; y: number };
    scale: number;
    seam: { x: number; width: number; visible: boolean };
    /** 缝内容的透明度：开口比排版宽度窄时随之淡出。 */
    contentOpacity: number;
    /** 边缘标签：自动出屏收起（collapsed）或手动折叠（hidden）时出现。 */
    tab: { visible: boolean; side: 'left' | 'right' };
    /** 两个世界层共同的倾斜（屏幕坐标里绕 pivot 转）；deg 为 0 时不转。 */
    tilt: { deg: number; pivotX: number; pivotY: number };
};

/** 内容透明度：原型的 (开口 / 排版宽度 − .35) / .65，开到三成五以下就看不见。 */
const contentOpacityFor = (width: number, contentWidth: number) => (
    Math.max(0, Math.min(1, (width / Math.max(contentWidth, 1) - 0.35) / 0.65))
);

export const computeBravaisFrame = ({ center, view, anchorX, openWidth, contentWidth, hidden, pinned = false, tiltDeg = 0 }: BravaisFrameInput): BravaisFrame => {
    const camera = cameraFromViewCenter(center, view);
    if (anchorX === null) {
        return {
            left: { x: camera.x, y: camera.y },
            right: { x: camera.x, y: camera.y },
            scale: view.scale,
            seam: { x: view.width / 2, width: 0, visible: false },
            contentOpacity: 0,
            tab: { visible: false, side: 'left' },
            tilt: { deg: 0, pivotX: 0, pivotY: 0 },
        };
    }
    // 歌手海报：缝不是开口，钉在左边；墙整面按相机画（锚点由相机放在海报右缘之外，见 planPinnedOpening）。
    // 倾斜绕海报右缘、视口半高转，所以海报边上的墙离它最近的那一段不动。
    if (pinned) {
        const width = Math.max(0, Math.min(openWidth, view.width));
        return {
            left: { x: camera.x, y: camera.y },
            right: { x: camera.x, y: camera.y },
            scale: view.scale,
            seam: { x: width / 2, width, visible: width >= 1 },
            contentOpacity: contentOpacityFor(width, contentWidth),
            tab: { visible: hidden, side: 'left' },
            tilt: { deg: tiltDeg, pivotX: width, pivotY: view.height / 2 },
        };
    }
    const geometry = getSeamGeometry({ anchorX, cameraX: center.x, openWidth, view });
    const offsets = getSeamSplitOffsets(geometry.width, view.scale, BRAVAIS_METRICS);
    const layoutWidth = Math.max(contentWidth, 1);
    return {
        left: { x: camera.x + offsets.left, y: camera.y },
        right: { x: camera.x + offsets.right, y: camera.y },
        scale: view.scale,
        seam: { x: geometry.screenX, width: geometry.width, visible: geometry.width >= 1 },
        // 原型：(开口 / 排版宽度 − .35) / .65，开到三成五以下就看不见。
        contentOpacity: contentOpacityFor(geometry.width, layoutWidth),
        tab: { visible: hidden || geometry.collapsed, side: geometry.side },
        tilt: { deg: tiltDeg, pivotX: geometry.screenX + geometry.width / 2, pivotY: view.height / 2 },
    };
};

/**
 * 歌手海报的相机：锚点（块边界）放在海报右缘再往右 BRAVAIS_SEAM_POSTER_WALL_GAP_PX 的屏幕位置，墙的第一列从那里开始。
 * preferX 给出时沿用那条块边界（同一层里换开口），否则取此刻落在那个位置附近的块边界。
 */
export const planPinnedOpening = ({ center, view, width, preferX }: {
    center: WallViewCenter;
    view: WallView;
    width: number;
    preferX?: number;
}): { anchorX: number; center: WallViewCenter } => {
    const offset = (width + BRAVAIS_SEAM_POSTER_WALL_GAP_PX - getViewLineX(view)) / view.scale;
    const anchorX = preferX ?? nearestSeamBoundaryX(center.x + offset, BRAVAIS_METRICS);
    return { anchorX, center: { x: anchorX - offset, y: center.y } };
};

/** 世界层的 transform 前面加上绕屏幕点的倾斜（世界层的 transform-origin 是 0 0，与屏幕原点重合）。 */
export const withTilt = (transform: string, tilt: BravaisFrame['tilt']) => (
    Math.abs(tilt.deg) < 0.001
        ? transform
        : `translate(${tilt.pivotX}px, ${tilt.pivotY}px) rotate(${tilt.deg}deg) translate(${-tilt.pivotX}px, ${-tilt.pivotY}px) ${transform}`
);

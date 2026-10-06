import { cubicBezier } from 'framer-motion';
import { BRAVAIS_REFLOW_EASE } from './bravaisConstants';
import type { PlateRect } from './bravaisBlockPlate';

// src/library/suites/bravais/bravaisReflowMotion.ts
// 聚焦卡块内让位时，块底板逐帧重画要知道窗磁贴此刻画在哪。让位是外框上的 CSS 过渡（.bravais-tile.is-reflowing：
// transform / width / height，500ms，同一条 cubic-bezier）。不逐帧读样式（B6b③ 每帧对块内磁贴 getComputedStyle）：
// 让位开始时从浏览器建好的 CSSTransition 里读一次起止值与时长（被打断时浏览器从当时的位置起步、往回走时还会缩短
// 时长——这些都以它为准），之后每帧只读 animation.currentTime（时间轴的量，不触发样式计算），按已知的缓动推算位置。

const ease = cubicBezier(...BRAVAIS_REFLOW_EASE);

type ReflowProperty = 'transform' | 'width' | 'height';

/** 用到的 Animation 的那一小部分（单测里用普通对象代替）。 */
export type ReflowAnimation = {
    readonly currentTime: CSSNumberish | null;
    readonly playState: AnimationPlayState;
};

/** 一个属性的一段过渡：起止值（transform 取平移 x / y，宽高各一个数）与时长。 */
export type ReflowChannel = {
    property: ReflowProperty;
    from: readonly number[];
    to: readonly number[];
    duration: number;
    delay: number;
    animation: ReflowAnimation;
};

const parseTranslate = (value: unknown): number[] | null => {
    if (typeof value !== 'string') return null;
    try {
        const matrix = new DOMMatrixReadOnly(value === 'none' ? undefined : value);
        return [matrix.m41, matrix.m42];
    } catch {
        return null;
    }
};

const parseLength = (value: unknown): number[] | null => {
    const length = typeof value === 'string' ? parseFloat(value) : Number.NaN;
    return Number.isFinite(length) ? [length] : null;
};

const isReflowProperty = (property: string): property is ReflowProperty => (
    property === 'transform' || property === 'width' || property === 'height'
);

/**
 * 读一张磁贴外框上正在跑的让位过渡（每次让位开始时调一次）。`getAnimations()` 会先把挂起的样式算完，过渡就在这一刻
 * 建好；开始时间可能要到下一帧才定，那之前 currentTime 停在 0（画在起点）。
 */
export const captureReflowChannels = (tile: Element): ReflowChannel[] => {
    const channels: ReflowChannel[] = [];
    for (const animation of tile.getAnimations()) {
        if (typeof CSSTransition === 'undefined' || !(animation instanceof CSSTransition)) continue;
        const property = animation.transitionProperty;
        if (!isReflowProperty(property) || !(animation.effect instanceof KeyframeEffect)) continue;
        const frames = animation.effect.getKeyframes();
        const parse = property === 'transform' ? parseTranslate : parseLength;
        const from = parse(frames[0]?.[property]);
        const to = parse(frames.at(-1)?.[property]);
        const timing = animation.effect.getTiming();
        const duration = typeof timing.duration === 'number' ? timing.duration : 0;
        if (!from || !to || duration <= 0) continue;
        channels.push({ property, from, to, duration, delay: timing.delay ?? 0, animation });
    }
    return channels;
};

/** 这段过渡此刻的进度（0–1，未缓动）；被取消（idle）当作已到终点。 */
const progressOf = (channel: ReflowChannel) => {
    const { animation } = channel;
    if (animation.playState === 'idle' || animation.playState === 'finished') return 1;
    const time = typeof animation.currentTime === 'number' ? animation.currentTime : 0;
    return Math.min(1, Math.max(0, (time - channel.delay) / channel.duration));
};

/** 磁贴此刻的矩形：有过渡的属性按缓动插值，没有的取落定矩形。 */
export const sampleReflowRect = (channels: readonly ReflowChannel[], target: PlateRect): PlateRect => {
    const rect = { ...target };
    for (const channel of channels) {
        const progress = progressOf(channel);
        const eased = progress >= 1 ? 1 : ease(progress);
        const value = (index: number) => channel.from[index]! + (channel.to[index]! - channel.from[index]!) * eased;
        if (channel.property === 'transform') {
            rect.x = value(0);
            rect.y = value(1);
        } else if (channel.property === 'width') {
            rect.width = value(0);
        } else {
            rect.height = value(0);
        }
    }
    return rect;
};

/** 这些过渡是不是都放完了。 */
export const isReflowSettled = (channels: Iterable<ReflowChannel>) => {
    for (const channel of channels) {
        if (progressOf(channel) < 1) return false;
    }
    return true;
};

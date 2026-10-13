import { getSizedCoverUrl } from '../../../utils/coverUrl';
import { normalizeCoverUrl } from './bravaisAlbumWall';

// src/library/suites/bravais/bravaisCoverFlight.ts
// 歌手页 ↔ 专辑页的封面飞行：点开专辑时，被点的那张专辑磁贴的封面飞到专辑海报上封面的位置（连同墙的倾斜，落到海报
// 封面自己的角度）；从这张专辑返回时，海报上的封面飞回墙上原来那一格。
// - 飞的是一张盖在最上面的 fixed 图（document.body 里），不碰墙与海报的 DOM 结构；去程时海报自己的封面先藏着，落地才露出来。
// - 两头都可能在动（相机补间、缝张开、倾斜），所以每帧重新量终点（measureQuad：在元素的三个角放零尺寸探针，读出屏幕上的
//   角点，倾斜与缩放都算在内），起点是出发那一刻量好的。
// - 去程的起点在点磁贴时记下（noteCoverFlightSource），海报挂载时取走（1.5s 内、封面相同才算）；回程按记下的 slot 找墙上
//   那一格（返回时墙按记忆恢复，原来那一格还是这张专辑）。
// - 降低动态效果（lattice）时不飞。

type Point = { x: number; y: number };
/** 元素在屏幕上的样子：中心、宽高（元素自己的坐标系里，已乘上缩放）、角度（弧度）。 */
export type BravaisQuad = { center: Point; width: number; height: number; angle: number };

const FLIGHT_MS = 640;
const BACK_FLIGHT_MS = 560;
const SOURCE_TTL_MS = 1500;
const BACK_WAIT_MS = 900;
const BASE_PX = 512;

const reducedMotion = () => (document.documentElement.dataset.reduceMotion ?? '').split(/\s+/).includes('lattice');

/** 元素三个角在屏幕上的位置 → 中心、宽高、角度。元素要是定位元素（探针按 absolute 放）。 */
export const measureQuad = (element: Element): BravaisQuad | null => {
    if (!element.isConnected) return null;
    const probe = (left: string, top: string) => {
        const span = document.createElement('span');
        span.style.cssText = `position:absolute;left:${left};top:${top};width:0;height:0;margin:0;padding:0;border:0;pointer-events:none;`;
        element.appendChild(span);
        const rect = span.getBoundingClientRect();
        span.remove();
        return { x: rect.left, y: rect.top };
    };
    const a = probe('0', '0');
    const b = probe('100%', '0');
    const c = probe('0', '100%');
    const width = Math.hypot(b.x - a.x, b.y - a.y);
    const height = Math.hypot(c.x - a.x, c.y - a.y);
    if (width < 1 || height < 1) return null;
    return {
        center: { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 },
        width,
        height,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
};

/** 两个状态之间插值（角度走最近的那一边）。 */
export const lerpQuad = (from: BravaisQuad, to: BravaisQuad, t: number): BravaisQuad => {
    let turn = to.angle - from.angle;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    const mix = (a: number, b: number) => a + (b - a) * t;
    return {
        center: { x: mix(from.center.x, to.center.x), y: mix(from.center.y, to.center.y) },
        width: mix(from.width, to.width),
        height: mix(from.height, to.height),
        angle: from.angle + turn * t,
    };
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

type Flight = { stop: () => void };
let current: Flight | null = null;

/** 飞一次：from 是固定的起点，target() 每帧给出终点（null = 终点没了，就地淡出）。 */
const fly = ({ url, from, target, duration, onDone }: {
    url: string;
    from: BravaisQuad;
    target: () => BravaisQuad | null;
    duration: number;
    onDone?: () => void;
}) => {
    current?.stop();
    const image = document.createElement('div');
    image.className = 'bravais-cover-flight';
    image.setAttribute('aria-hidden', 'true');
    image.dataset.bravaisCoverFlight = '';
    image.style.cssText = `position:fixed;left:0;top:0;width:${BASE_PX}px;height:${BASE_PX}px;z-index:2147483000;pointer-events:none;`
        + `background:#222 center/cover no-repeat url("${getSizedCoverUrl(url, BASE_PX) || url}");transform-origin:0 0;will-change:transform;`;
    document.body.appendChild(image);
    const startedAt = performance.now();
    let frame = 0;
    let last = from;
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(frame);
        onDone?.();
        const fade = image.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out', fill: 'forwards' });
        fade.onfinish = () => image.remove();
        if (current === flight) current = null;
    };
    const draw = (quad: BravaisQuad, lift: number) => {
        // 宽高直接写（不按比例拉伸）：起点与终点比例不同时封面按 cover 裁切，不变形。
        image.style.width = `${quad.width}px`;
        image.style.height = `${quad.height}px`;
        image.style.transform = `translate(${quad.center.x}px, ${quad.center.y}px) rotate(${quad.angle}rad) scale(${1 + lift * 0.06}) translate(-50%, -50%)`;
        image.style.boxShadow = `${lift * 18}px ${lift * 22}px ${lift * 36}px rgba(0,0,0,${0.18 + lift * 0.3})`;
    };
    const step = (now: number) => {
        const t = Math.min(1, (now - startedAt) / duration);
        const to = target() ?? last;
        last = to;
        draw(lerpQuad(from, to, easeInOut(t)), Math.sin(Math.PI * t));
        if (t >= 1) finish();
        else frame = requestAnimationFrame(step);
    };
    const flight: Flight = { stop: finish };
    current = flight;
    draw(from, 0);
    frame = requestAnimationFrame(step);
    return flight;
};

// ---- 去程：点专辑磁贴 → 专辑海报 ----

type Source = { cardKey: string; slotKey: string; coverUrl: string; quad: BravaisQuad; at: number };
let source: Source | null = null;

/** 点了一张专辑磁贴：记下它此刻的样子（真正打开专辑时海报来取）。 */
export const noteCoverFlightSource = (tile: Element, cardKey: string, slotKey: string, coverUrl: string | undefined) => {
    if (!coverUrl) return;
    const quad = measureQuad(tile);
    source = quad ? { cardKey, slotKey, coverUrl, quad, at: performance.now() } : null;
};

/** 专辑海报挂载：封面相同、刚点过的，取走它。 */
export const takeCoverFlightSource = (coverUrl: string | undefined): Source | null => {
    const taken = source;
    source = null;
    if (!taken || !coverUrl || reducedMotion()) return null;
    if (performance.now() - taken.at > SOURCE_TTL_MS) return null;
    return normalizeCoverUrl(taken.coverUrl) === normalizeCoverUrl(coverUrl) ? taken : null;
};

/** 从起点飞到海报上的封面（每帧量它）；落地时 onLand 让海报露出自己的封面。 */
export const flyCoverToPoster = (from: Source, cover: Element, onLand: () => void) => fly({
    url: from.coverUrl,
    from: from.quad,
    target: () => measureQuad(cover),
    duration: FLIGHT_MS,
    onDone: onLand,
});

// ---- 回程：专辑海报 → 墙上原来那一格 ----

/**
 * 海报卸载时调。起点用海报事先量好的封面样子（from）——卸载那一刻换层已经开始，海报的布局不可靠。下一帧封面真的不在了
 * （不是开发模式下 effect 重跑）才出发，等墙上那一格出现（换层后 slot 重新渲染），飞回去。
 */
export const flyCoverBack = ({ cover, from, slotKey, coverUrl }: { cover: Element; from: BravaisQuad; slotKey: string; coverUrl: string }) => {
    if (reducedMotion()) return;
    const find = () => document.querySelector(`.bravais-tile[data-bravais-slot="${CSS.escape(slotKey)}"]`);
    const startedAt = performance.now();
    const wait = () => {
        if (cover.isConnected) return;
        const tile = find();
        if (tile) {
            fly({ url: coverUrl, from, target: () => (tile.isConnected ? measureQuad(tile) : null), duration: BACK_FLIGHT_MS });
            return;
        }
        if (performance.now() - startedAt < BACK_WAIT_MS) requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
};

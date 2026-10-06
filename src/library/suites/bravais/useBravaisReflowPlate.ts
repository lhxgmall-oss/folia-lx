import { useLayoutEffect, type MutableRefObject, type RefObject } from 'react';
import { parseWallSlotKey } from '../../../components/wall/wallSlots';
import { BRAVAIS_REFLOW_MS } from './bravaisConstants';
import { buildPlatePath, type PlateBlock, type PlateRect } from './bravaisBlockPlate';
import { captureReflowChannels, isReflowSettled, sampleReflowRect, type ReflowChannel } from './bravaisReflowMotion';

// src/library/suites/bravais/useBravaisReflowPlate.ts
// 聚焦卡块内让位期间，只逐帧重画这一个块的底板路径（设计稿 §11）：窗磁贴在动，洞跟着它们的实时矩形走，缝隙与临时
// 拉开的空隙保持实色。路径直接写到这块 SVG 的 <path d> 上，不经过 React；过渡放完（或被取消）后写回落定的路径——
// 与 React 渲染的那份是同一个字符串，所以 React 之后的比较照常。块外不动，别的块不重画。
// 实时矩形按让位开始时读到的过渡参数推算（bravaisReflowMotion），每帧只读 animation.currentTime。

/** 过渡最长 BRAVAIS_REFLOW_MS（往回走时更短），开始时间可能晚一两帧才定；到点仍没放完也写回落定路径。 */
const SETTLE_DEADLINE_MS = BRAVAIS_REFLOW_MS + 120;

const blockKeyOfReflow = (reflow: ReadonlyMap<string, PlateRect>) => {
    const first = reflow.keys().next();
    const address = first.done ? null : parseWallSlotKey(first.value);
    return address ? `${address.column},${address.row}` : null;
};

export const useBravaisReflowPlate = ({
    active,
    reflow,
    platesRef,
    fieldRef,
}: {
    /** 透明档（有块底板）且没有降低动效（降低动效时让位没有过渡）。 */
    active: boolean;
    /** 聚焦卡所在块的让位矩形（slot key → 新矩形）；空表示没有聚焦卡。 */
    reflow: ReadonlyMap<string, PlateRect>;
    /** 此刻渲染的块底板（块 key → 底板），每次渲染更新。 */
    platesRef: MutableRefObject<ReadonlyMap<string, PlateBlock>>;
    fieldRef: RefObject<HTMLElement | null>;
}) => {
    useLayoutEffect(() => {
        const blockKey = active ? blockKeyOfReflow(reflow) : null;
        const field = fieldRef.current;
        const svg = blockKey && field ? field.querySelector<SVGSVGElement>(`[data-bravais-plate-block="${blockKey}"]`) : null;
        const path = svg?.querySelector('path') ?? null;
        const block = blockKey ? platesRef.current.get(blockKey) : undefined;
        if (!blockKey || !field || !svg || !path || !block) return undefined;

        // 让位刚提交：读一次各窗磁贴外框上的过渡（这一刻浏览器把它们建好）。
        const channels = new Map<string, ReflowChannel[]>();
        for (const hole of block.holes) {
            const tile = field.querySelector(`[data-bravais-slot="${hole.key}"]`);
            const captured = tile ? captureReflowChannels(tile) : [];
            if (captured.length > 0) channels.set(hole.key, captured);
        }
        if (channels.size === 0) return undefined;
        const allChannels = Array.from(channels.values()).flat();

        let written = path.getAttribute('d') ?? '';
        const draw = () => {
            const latest = platesRef.current.get(blockKey);
            if (!latest) return;
            const rects = latest.holes.map(hole => {
                const tracks = channels.get(hole.key);
                return tracks ? sampleReflowRect(tracks, hole.rect) : hole.rect;
            });
            const d = buildPlatePath(latest, rects);
            if (d !== written) path.setAttribute('d', (written = d));
        };
        /** 写回落定的路径（与 React 渲染的那份相同）。 */
        const settle = () => {
            const latest = platesRef.current.get(blockKey);
            if (latest && latest.d !== written) path.setAttribute('d', (written = latest.d));
            svg.removeAttribute('data-bravais-plate-live');
        };

        svg.setAttribute('data-bravais-plate-live', '');
        // 这一帧画在起点（React 刚写进去的是落定路径）。
        draw();
        const started = performance.now();
        let raf = requestAnimationFrame(function tick(now) {
            if (isReflowSettled(allChannels) || now - started > SETTLE_DEADLINE_MS) {
                raf = 0;
                settle();
                return;
            }
            draw();
            raf = requestAnimationFrame(tick);
        });
        return () => {
            if (raf) cancelAnimationFrame(raf);
            settle();
        };
    }, [active, fieldRef, platesRef, reflow]);
};

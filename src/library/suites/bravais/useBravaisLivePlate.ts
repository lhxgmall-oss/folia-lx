import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { parseWallSlotKey, type WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_REFLOW_MS } from './bravaisConstants';
import type { BravaisDisplay } from './bravaisDisplay';
import type { BravaisFrame } from './bravaisFrame';
import {
    blockKeyOf,
    collectBlockHoleKeys,
    computeLivePlateMaskStyle,
    getBlockRect,
    type PlateRect,
} from './bravaisPlateMask';

// src/library/suites/bravais/useBravaisLivePlate.ts
// 聚焦卡块内让位期间的「局部底板」（设计稿 §11）。让位是 CSS 过渡（.bravais-tile.is-reflowing，500ms 带回弹），
// 块里的窗磁贴在动，主底板按落定位置挖的洞会对不上：这段时间主底板在整块上挖洞，局部底板盖住这一块，遮罩是
// 「块矩形 − 窗磁贴此刻的矩形」，每帧读这几张磁贴的实际 transform / 宽高写进 mask-position / -size（最多 12 层渐变，
// 不生成图片）。缝隙与临时拉开的空隙保持实色，窗里一直看得到 visualizer。过渡结束（BRAVAIS_REFLOW_MS + 两帧）后
// 置为落定：主底板按新位置挖洞，同一次提交里收起局部底板——两者画的是同一个东西，看不出切换。
// 降低动态效果时没有过渡，直接落定；收起聚焦卡是瞬时归位，同样不经过这段。

/** 过渡放完后再多等的时间，保证读到的是最终位置。 */
const SETTLE_SLACK_MS = 34;

type LiveState = {
    block: PlateRect;
    side: 'left' | 'right';
    elements: HTMLElement[];
    /** 上一次写进 style 的值，没变就不写。 */
    written: { image: string; composite: string; position: string; size: string };
};

const readTileRect = (element: HTMLElement): PlateRect | null => {
    if (!element.isConnected) return null;
    const style = getComputedStyle(element);
    const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
    return { x: matrix.m41, y: matrix.m42, width: parseFloat(style.width) || 0, height: parseFloat(style.height) || 0 };
};

const EMPTY_RECT: PlateRect = { x: 0, y: 0, width: 0, height: 0 };

export const useBravaisLivePlate = ({
    enabled,
    expandedSlotKey,
    reducedMotion,
    slots,
    display,
    anchorX,
    fieldRef,
    renderFrame,
}: {
    /** 透明档（有底板）才需要。 */
    enabled: boolean;
    expandedSlotKey: string | null;
    reducedMotion: boolean;
    slots: readonly WallSlot[];
    display: BravaisDisplay | null;
    anchorX: number | null;
    fieldRef: RefObject<HTMLElement | null>;
    renderFrame: () => void;
}) => {
    const livePlateRef = useRef<HTMLDivElement>(null);
    const liveRef = useRef<LiveState | null>(null);
    // 让位阶段：每次聚焦卡换了（含展开同一块里的另一张）重新开始；收起、降低动效、实色档时直接算落定。
    const animates = enabled && !reducedMotion;
    const [phase, setPhase] = useState({ key: expandedSlotKey, settled: true });
    if (phase.key !== expandedSlotKey) setPhase({ key: expandedSlotKey, settled: expandedSlotKey === null || !animates });
    const liveKey = phase.key === expandedSlotKey && !phase.settled && animates ? phase.key : null;
    const liveAddress = liveKey ? parseWallSlotKey(liveKey) : null;
    const liveBlockKey = liveAddress ? blockKeyOf(liveAddress) : null;

    const latest = useRef({ slots, display, anchorX });
    latest.current = { slots, display, anchorX };

    /** renderFrame 末尾调用：按块所在那一半墙此刻的平移，写局部底板的遮罩。 */
    const writeLive = useCallback((frame: BravaisFrame) => {
        const live = liveRef.current;
        const element = livePlateRef.current;
        if (!live || !element) return;
        const holes = live.elements.map(tile => readTileRect(tile) ?? EMPTY_RECT);
        const style = computeLivePlateMaskStyle(live.block, holes, live.side === 'left' ? frame.left : frame.right, frame.scale);
        const { written } = live;
        if (written.image !== style.image) element.style.maskImage = written.image = style.image;
        if (written.composite !== style.composite) element.style.maskComposite = written.composite = style.composite;
        if (written.position !== style.position) element.style.maskPosition = written.position = style.position;
        if (written.size !== style.size) element.style.maskSize = written.size = style.size;
    }, []);

    useLayoutEffect(() => {
        const element = livePlateRef.current;
        const address = liveKey ? parseWallSlotKey(liveKey) : null;
        if (!liveKey || !address || !element) return undefined;
        const { slots: currentSlots, display: currentDisplay, anchorX: currentAnchor } = latest.current;
        const blockKey = blockKeyOf(address);
        const block = getBlockRect(address.column, address.row);
        const field = fieldRef.current;
        const elements = collectBlockHoleKeys(currentSlots, currentDisplay, liveKey, blockKey)
            .map(key => field?.querySelector<HTMLElement>(`[data-bravais-slot="${key}"]`) ?? null)
            .filter((tile): tile is HTMLElement => tile !== null);
        liveRef.current = {
            block,
            side: currentAnchor !== null && block.x < currentAnchor ? 'left' : 'right',
            elements,
            written: { image: '', composite: '', position: '', size: '' },
        };
        element.style.display = '';
        renderFrame();
        const started = performance.now();
        let raf = requestAnimationFrame(function tick(now) {
            renderFrame();
            if (now - started >= BRAVAIS_REFLOW_MS + SETTLE_SLACK_MS) {
                setPhase(current => (current.key === liveKey ? { key: liveKey, settled: true } : current));
                return;
            }
            raf = requestAnimationFrame(tick);
        });
        return () => {
            cancelAnimationFrame(raf);
            liveRef.current = null;
            element.style.display = 'none';
        };
    }, [fieldRef, liveKey, renderFrame]);

    return { livePlateRef, liveBlockKey, writeLive };
};

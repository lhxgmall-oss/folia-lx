import { describe, expect, it } from 'vitest';
import { getBlockSlots, type WallSlot } from '@/components/wall/wallSlots';
import type { BravaisItem, BravaisLayer } from '@/library/suites/bravais/bravaisLayer';
import { createBravaisDisplay, resolveFocusReflow, resolveSlotFace } from '@/library/suites/bravais/bravaisDisplay';
import { computeBravaisFrame } from '@/library/suites/bravais/bravaisFrame';
import {
    buildPlateMaskLayer,
    collectBlockHoleKeys,
    collectPlateHoles,
    computeLivePlateMaskStyle,
    computePlateMaskStyle,
    getBlockRect,
    LIVE_PLATE_BLEED,
    plateMaskImage,
    type PlateMaskGeometry,
} from '@/library/suites/bravais/bravaisPlateMask';

// test/unit/library/bravais/bravaisPlateMask.test.ts
// 透光的实色底板（B6b③，设计稿 §11）：挖洞的矩形（窗、全透明的内容、让位中的整块）、左右两半按缝锚点分开、
// 遮罩路径只在洞的集合变了时重建（相机移动只改位置）、每帧的 mask-position / -size、局部底板的渐变层。

const metrics = { cellSize: 128, gap: 8 };
const items = (count: number): BravaisItem[] => Array.from({ length: count }, (_, index) => ({
    key: `t${index}`,
    kind: 'track',
    title: `t${index}`,
    subtitle: '',
    badge: String(index + 1),
}));
const layer: BravaisLayer = {
    key: 'a',
    sessionKey: 'a',
    surface: 'collection',
    mode: 'infinite',
    items: items(300),
    seam: { title: 'a', crumb: 'a', meta: '' },
    isInteractive: true,
    focusedEntryKey: null,
    nowPlayingKey: null,
    queuedKeys: new Set(),
};
const blocks = (columns: number[], rows: number[]): WallSlot[] => (
    columns.flatMap(column => rows.flatMap(row => getBlockSlots(column, row, metrics)))
);
const NO_REFLOW = new Map<string, WallSlot>();
const partial = createBravaisDisplay(layer, null, undefined, { look: 'partial', windowsPerBlock: 3 });
const holesFor = (slots: WallSlot[], overrides: Partial<Parameters<typeof collectPlateHoles>[0]> = {}) => collectPlateHoles({
    slots,
    display: partial,
    expandedSlotKey: null,
    reflow: NO_REFLOW,
    anchorX: null,
    liveBlockKey: null,
    ...overrides,
});

describe('collectPlateHoles', () => {
    it('digs nothing on the solid look', () => {
        const solid = createBravaisDisplay(layer, null);
        expect(holesFor(blocks([0, 1], [0]), { display: solid })).toEqual({ left: [], right: [] });
    });

    it('digs one hole per window on the partial look, split around the seam anchor', () => {
        const slots = blocks([-1, 0], [0]);
        const anchorX = 0 - metrics.gap / 2;
        const holes = holesFor(slots, { anchorX });
        expect(holes.left).toHaveLength(3);
        expect(holes.right).toHaveLength(3);
        holes.left.forEach(rect => expect(rect.x).toBeLessThan(anchorX));
        holes.right.forEach(rect => expect(rect.x).toBeGreaterThan(anchorX));
    });

    it('digs every tile but the focus card on the clear look', () => {
        const clear = createBravaisDisplay(layer, null, undefined, { look: 'clear', windowsPerBlock: 3 });
        const slots = blocks([0], [0]);
        expect(holesFor(slots, { display: clear }).right).toHaveLength(12);
        expect(holesFor(slots, { display: clear, expandedSlotKey: slots[4].key }).right).toHaveLength(11);
    });

    it('moves the windows of the focused block with the reflow (keys unchanged, rects re-geared)', () => {
        const slots = blocks([0], [0]);
        const content = slots.find(slot => resolveSlotFace(partial, slot).kind === 'content')!;
        const reflow = resolveFocusReflow(content.key);
        const holes = holesFor(slots, { expandedSlotKey: content.key, reflow }).right;
        const windows = slots.filter(slot => resolveSlotFace(partial, slot).kind === 'window');
        expect(holes).toEqual(windows.map(slot => {
            const rect = reflow.get(slot.key)!;
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }));
    });

    it('digs the whole block while it re-gears, and lists its windows for the live plate', () => {
        const slots = blocks([0, 1], [0]);
        const holes = holesFor(slots, { liveBlockKey: '0,0' });
        expect(holes.right).toContainEqual(getBlockRect(0, 0));
        expect(holes.right).toHaveLength(1 + 3);
        expect(collectBlockHoleKeys(slots, partial, null, '0,0')).toHaveLength(3);
        expect(collectBlockHoleKeys(slots, createBravaisDisplay(layer, null), null, '0,0')).toEqual([]);
    });
});

describe('mask rebuilds', () => {
    it('reuses the same layer (no new data URL) while the hole set stays the same', () => {
        const slots = blocks([0, 1], [0, 1]);
        const first = buildPlateMaskLayer(holesFor(slots).right, null);
        expect(first).not.toBeNull();
        expect(first!.url.startsWith('url("data:image/svg+xml,')).toBe(true);
        // 相机移动（同一组可见块）：洞没变，原样返回。
        expect(buildPlateMaskLayer(holesFor([...slots]).right, first)).toBe(first);
        // 可见块集合变了：重建。
        const grown = buildPlateMaskLayer(holesFor(blocks([0, 1, 2], [0, 1])).right, first);
        expect(grown).not.toBe(first);
        // 窗集合变了（多开一个窗）：重建。
        const more = createBravaisDisplay(layer, null, undefined, { look: 'partial', windowsPerBlock: 4 });
        expect(buildPlateMaskLayer(holesFor(slots, { display: more }).right, first)).not.toBe(first);
        expect(buildPlateMaskLayer([], first)).toBeNull();
    });

    it('keeps the path relative to the bounding box of the holes', () => {
        const layerBox = buildPlateMaskLayer([{ x: 100, y: 50, width: 20, height: 10 }, { x: 140, y: 80, width: 10, height: 10 }], null)!;
        expect(layerBox).toMatchObject({ x: 100, y: 50, width: 50, height: 40, path: 'M0 0h20v10h-20ZM40 30h10v10h-10Z' });
    });
});

describe('per-frame mask placement', () => {
    const view = { width: 1200, height: 800, scale: 0.5 };
    const geometry: PlateMaskGeometry = {
        left: { url: 'url(left)', path: '', x: -400, y: 0, width: 200, height: 100 },
        right: { url: 'url(right)', path: '', x: 100, y: -50, width: 300, height: 100 },
    };

    it('lists the base, both halves and the seam as four mask layers', () => {
        expect(plateMaskImage(geometry)).toBe('linear-gradient(#000 0 0), url(left), url(right), linear-gradient(#000 0 0)');
        expect(plateMaskImage({ left: null, right: null })).toBe('linear-gradient(#000 0 0), none, none, linear-gradient(#000 0 0)');
    });

    it('follows each half of the wall and the seam', () => {
        const frame = computeBravaisFrame({ center: { x: 0, y: 0 }, view, anchorX: 0, openWidth: 300, contentWidth: 300, hidden: false });
        const style = computePlateMaskStyle(frame, geometry);
        const [base, left, right, seam] = style.position.split(', ');
        expect(base).toBe('0px 0px');
        expect(left).toBe(`${frame.left.x - 200}px ${frame.left.y}px`);
        expect(right).toBe(`${frame.right.x + 50}px ${frame.right.y - 25}px`);
        expect(seam).toBe(`${frame.seam.x - 150}px 0px`);
        expect(style.size.split(', ')).toEqual(['100% 100%', '100px 50px', '150px 50px', '300px 100%']);

        // 拖动（只改视图中心）：位置变了，路径（geometry）用的还是同一份。
        const moved = computePlateMaskStyle(
            computeBravaisFrame({ center: { x: 40, y: 10 }, view, anchorX: 0, openWidth: 300, contentWidth: 300, hidden: false }),
            geometry,
        );
        expect(moved.position).not.toBe(style.position);
        expect(moved.size).toBe(style.size);
    });

    it('drops the seam hole when the seam is shut', () => {
        const frame = computeBravaisFrame({ center: { x: 0, y: 0 }, view, anchorX: null, openWidth: 0, contentWidth: 0, hidden: false });
        expect(computePlateMaskStyle(frame, geometry).size.split(', ')[3]).toBe('0px 0px');
    });

    it('builds the live plate from the block (with bleed) minus the moving windows', () => {
        const block = getBlockRect(0, 0);
        const style = computeLivePlateMaskStyle(block, [{ x: 10, y: 20, width: 100, height: 50 }], { x: 5, y: 7 }, 0.5);
        expect(style.composite).toBe('subtract, add');
        expect(style.image.split('), ').length).toBe(2);
        expect(style.position).toBe(`${5 - LIVE_PLATE_BLEED * 0.5}px ${7 - LIVE_PLATE_BLEED * 0.5}px, 10px 17px`);
        expect(style.size).toBe(`${(block.width + LIVE_PLATE_BLEED) * 0.5}px ${(block.height + LIVE_PLATE_BLEED) * 0.5}px, 50px 25px`);
    });
});

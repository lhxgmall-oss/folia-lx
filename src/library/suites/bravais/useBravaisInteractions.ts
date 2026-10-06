import { useCallback, useMemo, type MutableRefObject, type RefObject } from 'react';
import { getViewWorldBounds, type WallViewCenter } from '../../../components/wall/wallView';
import { overlaps } from '../../../components/wall/layout';
import { getWallSlot, parseWallSlotKey, type WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_METRICS } from './bravaisConstants';
import { findNearestSlot, resolveSlotItem, type BravaisDisplay } from './bravaisDisplay';
import { resolveEscapeStep, type BravaisKeyAction } from './bravaisKeyboardModel';
import { findAdjacentSlot } from './bravaisNavigation';
import { setBravaisPendingOrigin } from './bravaisStageStore';
import { closeBravaisPanel } from './bravaisPanelHistory';
import { setBravaisWallHoverKey, useBravaisUiStore } from './bravaisUiStore';
import type { BravaisTileHandlers } from './BravaisTile';
import type { BravaisFrameState } from './useBravaisFrame';
import type { useBravaisFocus } from './useBravaisFocus';

// src/library/suites/bravais/useBravaisInteractions.ts
// 点击与按键 → 动作：点歌曲磁贴就地展开聚焦卡（不播放），点歌单 / 专辑卡 push 下一层（先把被点的 slot 记成新层的
// 起点）；聚焦卡上的「立即播放」「加入队列」、歌手 / 专辑链接；方向键空间导航、Enter / Shift+Enter / Alt+Enter、
// Esc 阶梯、Home、PgUp / PgDn、Tab 在墙与缝之间。动作一律经层描述的回调交给 surface，stage 不碰数据。

type BravaisFocus = ReturnType<typeof useBravaisFocus>;

export const bravaisSlotFromKey = (key: string | null): WallSlot | null => {
    const address = key ? parseWallSlotKey(key) : null;
    return address ? getWallSlot(address.column, address.row, address.slotIndex, BRAVAIS_METRICS) : null;
};

const NO_MENU: readonly never[] = [];

const isControlTarget = (target: EventTarget | null) => (
    target instanceof Element && Boolean(target.closest('button, a[href], input, select, textarea'))
);

export const useBravaisInteractions = ({
    displayRef,
    focus,
    slotsRef,
    frameRef,
    tweenTo,
    rootRef,
    fieldRef,
    seamRef,
}: {
    displayRef: MutableRefObject<BravaisDisplay | null>;
    focus: BravaisFocus;
    slotsRef: MutableRefObject<readonly WallSlot[]>;
    frameRef: MutableRefObject<BravaisFrameState>;
    tweenTo: (center: WallViewCenter) => void;
    rootRef: RefObject<HTMLElement | null>;
    fieldRef: RefObject<HTMLDivElement | null>;
    seamRef: RefObject<HTMLDivElement | null>;
}) => {
    // 只取 focus 里身份稳定的成员：磁贴的 handlers 要跨渲染保持同一个对象，否则每张磁贴的 memo 都会失效。
    const { focusSlot, expand, collapse, expandedRef, focusedRef, drawnRect } = focus;
    const itemAt = useCallback((slotKey: string | null) => {
        const slot = bravaisSlotFromKey(slotKey);
        return slot ? resolveSlotItem(displayRef.current, slot) : null;
    }, [displayRef]);

    /** 从一张磁贴打开下一层：先记下起点（新层到达时它原地成为第 1 项）。 */
    const openFrom = useCallback((slotKey: string, open: () => void) => {
        const layer = displayRef.current?.layer;
        if (!layer) return;
        setBravaisPendingOrigin({ fromLayerKey: layer.key, slotKey });
        open();
    }, [displayRef]);

    const handlers = useMemo<BravaisTileHandlers>(() => ({
        activate: slotKey => {
            const slot = bravaisSlotFromKey(slotKey);
            const item = itemAt(slotKey);
            const layer = displayRef.current?.layer;
            if (!slot || !item || !layer) {
                collapse();
                return;
            }
            focusSlot(slot);
            if (item.kind === 'track') {
                if (expandedRef.current !== slotKey) expand(slot);
                return;
            }
            collapse();
            if (layer.onOpenItem) openFrom(slotKey, () => layer.onOpenItem!(item.key));
        },
        play: slotKey => {
            const item = itemAt(slotKey);
            if (item) displayRef.current?.layer.onPlayItem?.(item.key);
        },
        enqueue: slotKey => {
            const item = itemAt(slotKey);
            if (item) displayRef.current?.layer.onEnqueueItem?.(item.key);
        },
        canOpenAlbum: itemKey => Boolean(displayRef.current?.layer.canOpenAlbum?.(itemKey)),
        openAlbum: slotKey => {
            const item = itemAt(slotKey);
            const layer = displayRef.current?.layer;
            if (item && layer?.onOpenAlbum && layer.canOpenAlbum?.(item.key)) openFrom(slotKey, () => layer.onOpenAlbum!(item.key));
        },
        canOpenArtist: (itemKey, index) => Boolean(displayRef.current?.layer.canOpenArtist?.(itemKey, index)),
        openArtist: (slotKey, index) => {
            const item = itemAt(slotKey);
            const layer = displayRef.current?.layer;
            if (item && layer?.onOpenArtist && layer.canOpenArtist?.(item.key, index)) {
                openFrom(slotKey, () => layer.onOpenArtist!(item.key, index));
            }
        },
        // B7：聚焦卡「⋯」。移出歌单先记下这张的 slot（两段翻牌从它开始）、收起聚焦卡，再交给 surface。
        menuFor: itemKey => displayRef.current?.layer.entries?.menuFor?.(itemKey) ?? NO_MENU,
        runMenu: (slotKey, actionId) => {
            const item = itemAt(slotKey);
            const layer = displayRef.current?.layer;
            if (!item || !layer?.entries?.onMenuAction) return;
            if (actionId === 'remove-entry') {
                useBravaisUiStore.setState({ removalOrigin: { layerKey: layer.key, slotKey } });
                collapse();
            }
            layer.entries.onMenuAction(item.key, actionId);
        },
        // 悬停磁贴：列表面板开着时高亮并滚到对应的行（列表 ↔ 墙联动）。
        hover: slotKey => {
            const layer = displayRef.current?.layer;
            if (!layer || useBravaisUiStore.getState().panelFor !== layer.key) return;
            setBravaisWallHoverKey(slotKey ? itemAt(slotKey)?.key ?? null : null);
        },
    }), [collapse, displayRef, expand, expandedRef, focusSlot, itemAt, openFrom]);

    const hasContent = useCallback((slot: WallSlot) => resolveSlotItem(displayRef.current, slot) !== null, [displayRef]);

    /** 第一次按方向键：落在屏内离缝最近的有内容磁贴。 */
    const seedSlot = useCallback(() => {
        const { view, center, anchorX } = frameRef.current;
        if (!view) return null;
        const visible = getViewWorldBounds(center, view);
        const onScreen = slotsRef.current.filter(slot => overlaps(
            { left: slot.x, right: slot.x + slot.width, top: slot.y, bottom: slot.y + slot.height },
            visible,
        ));
        return findNearestSlot(onScreen, { x: anchorX ?? center.x, y: center.y }, hasContent);
    }, [frameRef, hasContent, slotsRef]);

    const focusWall = useCallback(() => fieldRef.current?.focus({ preventScroll: true }), [fieldRef]);

    const seamFocusables = useCallback(() => (
        [...(seamRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])]
            .filter(element => element.offsetParent !== null)
    ), [seamRef]);

    const handleTab = useCallback((backwards: boolean, target: EventTarget | null) => {
        const root = rootRef.current;
        const inStage = target instanceof Node && Boolean(root?.contains(target));
        if (!inStage && target !== document.body) return false;
        const focusables = seamFocusables();
        const inSeam = target instanceof Node && Boolean(seamRef.current?.contains(target));
        if (!inSeam) {
            if (focusables.length === 0) return false;
            (backwards ? focusables[focusables.length - 1] : focusables[0]).focus();
            return true;
        }
        const leaving = backwards ? target === focusables[0] : target === focusables[focusables.length - 1];
        if (!leaving) return false;
        focusWall();
        const current = bravaisSlotFromKey(focusedRef.current);
        focusSlot(current && hasContent(current) ? current : seedSlot(), { reveal: true });
        return true;
    }, [focusSlot, focusWall, focusedRef, hasContent, rootRef, seamFocusables, seamRef, seedSlot]);

    const handleAction = useCallback((action: BravaisKeyAction, target: EventTarget | null): boolean => {
        const display = displayRef.current;
        const layer = display?.layer;
        if (!layer) return false;
        if (action.type === 'tab') return handleTab(action.backwards, target);
        if (action.type === 'escape') {
            const step = resolveEscapeStep({
                hasForm: Boolean(layer.entries?.hasForm),
                hasFocusCard: expandedRef.current !== null,
                hasKeyboardFocus: focusedRef.current !== null,
                hasPanel: useBravaisUiStore.getState().panelFor === layer.key,
                hasQuery: Boolean(layer.entries?.hasQuery),
                canGoBack: Boolean(layer.onBack),
            });
            if (step === 'form') layer.entries?.cancelForm?.();
            else if (step === 'focus-card') collapse();
            else if (step === 'keyboard-focus') focusSlot(null);
            else if (step === 'panel') closeBravaisPanel();
            else if (step === 'query') layer.entries?.clearQuery?.();
            else if (step === 'back') layer.onBack!();
            return step !== null;
        }
        // 缝里的按钮、页面上别的控件保留自己的按键（Enter 激活按钮）。
        if (isControlTarget(target)) return false;
        const focusedKey = focusedRef.current;
        const focused = bravaisSlotFromKey(focusedKey);
        switch (action.type) {
            case 'move': {
                const next = focused && hasContent(focused)
                    ? findAdjacentSlot(focused, action.direction, { drawn: drawnRect, hasContent })
                    : seedSlot();
                if (!next) return false;
                focusWall();
                focusSlot(next, { reveal: true });
                return true;
            }
            case 'first': {
                // 有限拼贴（过滤中）：rank 0；无限拼贴：起点磁贴（第 1 项）。
                const start = display.finite
                    ? (display.layer.items.length > 0 ? display.finite.order[0] ?? null : null)
                    : bravaisSlotFromKey(display.startSlotKey) ?? seedSlot();
                if (!start) return false;
                focusWall();
                focusSlot(start, { reveal: true });
                return true;
            }
            case 'last': {
                // 只有有限拼贴有「最后一项」。
                const last = display.finite ? display.finite.order[display.layer.items.length - 1] ?? null : null;
                if (!last) return false;
                focusWall();
                focusSlot(last, { reveal: true });
                return true;
            }
            case 'page': {
                const { view, center } = frameRef.current;
                if (!view) return false;
                tweenTo({ x: center.x, y: center.y + action.direction * view.height * 0.85 / view.scale });
                return true;
            }
            default: break;
        }
        const item = focusedKey ? itemAt(focusedKey) : null;
        if (!focused || !item) return false;
        if (action.type === 'enter') {
            if (item.kind !== 'track') handlers.activate(focused.key);
            else if (expandedRef.current === focused.key) handlers.play(focused.key);
            else expand(focused);
            return true;
        }
        if (item.kind !== 'track') return false;
        if (action.type === 'enqueue') handlers.enqueue(focused.key);
        else if (action.type === 'open-album') handlers.openAlbum(focused.key);
        else if (action.type === 'open-artist') handlers.openArtist(focused.key, 0);
        return true;
    }, [collapse, displayRef, drawnRect, expand, expandedRef, focusSlot, focusWall, focusedRef, frameRef, handleTab, handlers, hasContent, itemAt, seedSlot, tweenTo]);

    return { handlers, handleAction, itemAt, seedSlot, focusWall };
};

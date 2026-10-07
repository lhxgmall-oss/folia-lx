import { useCallback, useMemo, type MutableRefObject, type RefObject } from 'react';
import { getViewWorldBounds, type WallViewCenter } from '../../../components/wall/wallView';
import { overlaps } from '../../../components/wall/layout';
import { getWallSlot, parseWallSlotKey, type WallSlot } from '../../../components/wall/wallSlots';
import { BRAVAIS_METRICS } from './bravaisConstants';
import { findNearestSlot, resolveSlotFace, resolveSlotItem, type BravaisDisplay } from './bravaisDisplay';
import { resolveEscapeStep, type BravaisKeyAction } from './bravaisKeyboardModel';
import type { BravaisHomeKeyAction } from './bravaisHomeKeys';
import { findAdjacentSlot } from './bravaisNavigation';
import { setBravaisPendingOrigin } from './bravaisStageStore';
import { armBravaisPlayingCard } from './bravaisPlayingCard';
import { closeBravaisPanel } from './bravaisPanelHistory';
import { setBravaisWallHoverKey, useBravaisUiStore } from './bravaisUiStore';
import { setBravaisSearchOpen } from './bravaisHomeUiStore';
import { useBravaisSeamStore } from './bravaisSeamLevel';
import { useAppViewStore } from '../../../stores/useAppViewStore';
import type { BravaisTileHandlers } from './BravaisTile';
import type { BravaisFrameState } from './useBravaisFrame';
import type { useBravaisFocus } from './useBravaisFocus';

// src/library/suites/bravais/useBravaisInteractions.ts
// 点击与按键 → 动作：点歌曲磁贴就地展开聚焦卡（不播放），点歌单 / 专辑卡 push 下一层（先把被点的 slot 记成新层的
// 起点）；聚焦卡上的「立即播放」「加入队列」、歌手 / 专辑链接；方向键空间导航、Enter / Shift+Enter / Alt+Enter、
// Esc 阶梯、Home、PgUp / PgDn、Tab 在墙与缝之间。动作一律经层描述的回调交给 surface，stage 不碰数据。
// B9 首页：批量模式（目录树面板开着）里点卡片 / Enter 只切换选中、绝不进入文件夹（拖动后的残余点击在磁贴里已吞掉）；
// 私人 FM 卡直接播放、不记起点；歌单类卡片的眼睛按钮；F6 切页签与批量按键（bravaisHomeKeys）；Esc 阶梯的「视图」一级
// 退出管理隐藏。
// fb3：聚焦卡的「立即播放」（点按钮或展开后再按 Enter）在正在播放的那首上是暂停 / 继续（宿主的播放开关）；其余的照旧
// 交给 surface 播放，并记下「回来时展开这一项」（bravaisPlayingCard）。「进入」按钮按设置进入播放视图。
// fb2：点窗（结构窗、透明档有限墙的空 slot）什么都不做：不收起聚焦卡、不动键盘焦点、不翻牌、不动相机。只有实色空画框
// （实色档或无限墙的空画框）与磁贴之间的墙面算「空白墙面」，点它收起聚焦卡。

type BravaisFocus = ReturnType<typeof useBravaisFocus>;

/** fb3：宿主经 stage 契约交来的播放开关与「进入播放视图」（最新值放 ref 里，磁贴的 handlers 才能保持同一个对象）。 */
export type BravaisStagePlayback = {
    toggle?: () => void;
    enter?: () => void;
};

/** 墙上的按键动作：通用的（bravaisKeyboardModel）与首页的（bravaisHomeKeys）。 */
export type BravaisWallKeyAction = BravaisKeyAction | BravaisHomeKeyAction;

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
    playbackRef,
    togglesCurrent,
    hasEnter,
}: {
    displayRef: MutableRefObject<BravaisDisplay | null>;
    focus: BravaisFocus;
    slotsRef: MutableRefObject<readonly WallSlot[]>;
    frameRef: MutableRefObject<BravaisFrameState>;
    tweenTo: (center: WallViewCenter) => void;
    rootRef: RefObject<HTMLElement | null>;
    fieldRef: RefObject<HTMLDivElement | null>;
    seamRef: RefObject<HTMLDivElement | null>;
    playbackRef: MutableRefObject<BravaisStagePlayback>;
    /** 宿主给了播放开关（正在播放的那首上，play 改为暂停 / 继续）。 */
    togglesCurrent: boolean;
    /** 宿主给了「进入播放视图」。 */
    hasEnter: boolean;
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
                // 窗不是墙面：点它没有反应（聚焦卡仍展开）。
                if (slot && resolveSlotFace(displayRef.current, slot).kind === 'window') return;
                collapse();
                return;
            }
            focusSlot(slot);
            // B9 批量模式：点卡片只切换选中，绝不进入文件夹（GridMap onSelect 里批量模式的提前 return）。
            const batch = layer.home?.batch;
            if (batch) {
                batch.toggle(item.key);
                return;
            }
            if (item.kind === 'track') {
                if (expandedRef.current !== slotKey) expand(slot);
                return;
            }
            collapse();
            if (!layer.onOpenItem) return;
            // 私人 FM：直接播放、不进新层，不记起点（否则下一次换页签会把它当起点）。
            if (item.direct) layer.onOpenItem(item.key);
            else openFrom(slotKey, () => layer.onOpenItem!(item.key));
        },
        toggleHidden: slotKey => {
            const item = itemAt(slotKey);
            if (item?.hideable) displayRef.current?.layer.home?.onToggleHidden?.(item.key);
        },
        play: slotKey => {
            const item = itemAt(slotKey);
            const layer = displayRef.current?.layer;
            if (!item || !layer) return;
            const toggle = playbackRef.current.toggle;
            if (toggle && layer.nowPlayingKey === item.key) {
                toggle();
                return;
            }
            armBravaisPlayingCard(layer.key, item.key);
            layer.onPlayItem?.(item.key);
        },
        togglesCurrent,
        enterPlayback: hasEnter ? () => playbackRef.current.enter?.() : undefined,
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
    }), [collapse, displayRef, expand, expandedRef, focusSlot, hasEnter, itemAt, openFrom, playbackRef, togglesCurrent]);

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

    const handleAction = useCallback((action: BravaisWallKeyAction, target: EventTarget | null): boolean => {
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
                hasViewMode: Boolean(layer.entries?.hasViewMode),
                hasQuery: Boolean(layer.entries?.hasQuery),
                canGoBack: Boolean(layer.onBack),
            });
            if (step === 'form') layer.entries?.cancelForm?.();
            else if (step === 'focus-card') collapse();
            else if (step === 'keyboard-focus') focusSlot(null);
            else if (step === 'panel') closeBravaisPanel();
            else if (step === 'view') layer.entries?.exitViewMode?.();
            else if (step === 'query') layer.entries?.clearQuery?.();
            else if (step === 'back') layer.onBack!();
            return step !== null;
        }
        // B9 首页：F6 切页签；批量模式的 Ctrl+A / Ctrl+Enter / Delete（不在首页、不在批量模式时不接，按键照常放行）。
        if (action.type === 'cycle-tab') return layer.home?.cycleTab?.(action.delta) ?? false;
        if (action.type === 'open-search') {
            // 有过滤框注册着（目录树面板开着）时 `/` 是过滤字符，留给命令面板。
            if (!layer.seam.home || useAppViewStore.getState().commandFilter) return false;
            if (useBravaisSeamStore.getState().level === 'hidden') useBravaisSeamStore.getState().restore();
            setBravaisSearchOpen(true);
            return true;
        }
        const batch = layer.home?.batch;
        if (action.type === 'batch-select-all' || action.type === 'batch-play' || action.type === 'batch-remove') {
            if (!batch) return false;
            if (action.type === 'batch-select-all') batch.selectAll();
            else if (action.type === 'batch-play') batch.play(action.enqueue);
            else batch.requestRemove();
            return true;
        }
        // 缝里的按钮、页面上别的控件保留自己的按键（Enter 激活按钮）。
        if (isControlTarget(target)) return false;
        const focusedKey = focusedRef.current;
        const focused = bravaisSlotFromKey(focusedKey);
        if (action.type === 'batch-toggle') {
            // Insert：切换焦点那张的选中，焦点往下走一格（TUI 目录页的「切换并下移」）。
            const current = focused ? itemAt(focused.key) : null;
            if (!batch || !focused || !current) return false;
            batch.toggle(current.key);
            const next = findAdjacentSlot(focused, 'down', { drawn: drawnRect, hasContent });
            if (next) focusSlot(next, { reveal: true });
            return true;
        }
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

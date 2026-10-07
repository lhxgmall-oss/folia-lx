import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { collectWallSlots, type WallSlot } from '../../../components/wall/wallSlots';
import { FLIP_MAX_TILES } from '../../../components/wall/flipPlan';
import { useDevicePixelRatio } from '../../../hooks/useMediaQuery';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { useLatticeSettingsStore } from '../../../stores/useLatticeSettingsStore';
import type { LibrarySuiteStageProps } from '../../core/contracts/suite';
import { BRAVAIS_METRICS, BRAVAIS_OVERSCAN, BRAVAIS_SEAM_ACRYLIC_BLUR } from './bravaisConstants';
import { resolveSlotItem, type BravaisDisplay } from './bravaisDisplay';
import type { BravaisLayer } from './bravaisLayer';
import { useBravaisSeamStore, type BravaisSeamLevel } from './bravaisSeamLevel';
import { resolveCurrentLayer, useBravaisStageStore } from './bravaisStageStore';
import BravaisSeam from './BravaisSeam';
import BravaisWall from './BravaisWall';
import { useBravaisCamera } from './useBravaisCamera';
import { useBravaisChromeActions } from './useBravaisChromeActions';
import { useBravaisDisplay } from './useBravaisDisplay';
import { useBravaisFocus } from './useBravaisFocus';
import { useBravaisFrame } from './useBravaisFrame';
import { bravaisSlotFromKey, useBravaisInteractions } from './useBravaisInteractions';
import { useBravaisKeyboard } from './useBravaisKeyboard';
import { useBravaisBlockPlates } from './useBravaisBlockPlates';
import { useBravaisPlayerSafeArea } from './useBravaisPlayerSafeArea';
import { useBravaisSeam } from './useBravaisSeam';
import { useBravaisViewport } from './useBravaisViewport';
import { closeCommandFilter, useAppViewStore } from '../../../stores/useAppViewStore';
import { findDisplayItemSlot } from './bravaisItemSlots';
import { closeBravaisPanel, openBravaisPanel, syncPanelWithHistory } from './bravaisPanelHistory';
import { resolveStageSeamTarget, type BravaisSeamTargetInput } from './bravaisSeamTarget';
import { useBravaisUiStore } from './bravaisUiStore';
import type { BravaisPanelActions } from './BravaisListPanel';
import { useBravaisWallLook } from './useBravaisWallLook';
import { setBravaisSearchOpen, useBravaisHomeUiStore } from './bravaisHomeUiStore';
import { useBravaisReducedTransitions } from './bravaisMotion';
import { useBravaisBeforePush } from './bravaisTransitions';
import { selectBravaisAccountVariant, useBravaisAccountStore } from './bravaisAccountStore';
import '../../../components/wall/wall.css';
import './bravais.css';

// src/library/suites/bravais/BravaisStage.tsx
// bravais 的常驻舞台（B1 的 stage 契约）：一面横跨首页与集合层的墙、相机、缝、翻牌、聚焦卡与键盘焦点。
// 层描述从 suite 内的 stage store 读（surface 推进来），stage 不碰 core 的资源与控制器。视觉沿用 Lattice
// （wall.css 的 .lattice-* 类与 --lattice-* 变量，跟随 Lattice 的染色与暗角设置），墙一律实色——透光（底板、窗、
// reportPlayerOcclusion）在 B6b③。高频的东西（相机、缝的开合、翻牌）都不经过 React：帧状态 + 直接写 DOM。
// 透光（B6b③，设计稿 §11）：实色档根节点画墙面并报告遮挡播放页；透明档根节点不画底，墙面交给世界层之下的实色底板
// （useBravaisPlate，遮罩只在窗位挖洞），缝的纸条换成半透明。
// B12b：底板改为按块的内联 SVG（useBravaisBlockPlates → BravaisWall 画进世界层、磁贴之下），不再有全屏遮罩底板与
// 局部底板；聚焦卡让位只逐帧重画那一块。
// B9：首页层的目录树面板与集合层的列表面板同一种开口；首页的全局搜索框开着时窄缝临时展开（search）；管理隐藏视图里
// 根节点挂 is-managing-hidden（歌单类磁贴的眼睛按钮常驻）。
// B10：账户的登录态 / 确认态是缝的内容态（bravaisAccountStore → login / confirm 变体），不接 accountLayerRef。

const expandBounds = (bounds: { left: number; right: number; top: number; bottom: number }, by: number) => ({
    left: bounds.left - by,
    right: bounds.right + by,
    top: bounds.top - by,
    bottom: bounds.bottom + by,
});

const BravaisStage: React.FC<LibrarySuiteStageProps> = ({ isInteractive, isDaylight, navigation, reportPlayerOcclusion }) => {
    const { t } = useTranslation();
    const rootRef = useRef<HTMLElement>(null);
    const fieldRef = useRef<HTMLDivElement>(null);
    const leftRef = useRef<HTMLDivElement>(null);
    const rightRef = useRef<HTMLDivElement>(null);
    const seamRef = useRef<HTMLDivElement>(null);
    const seamContentRef = useRef<HTMLDivElement>(null);
    const tabRef = useRef<HTMLButtonElement>(null);
    const frameRefs = useMemo(() => ({ left: leftRef, right: rightRef, seam: seamRef, seamContent: seamContentRef, tab: tabRef }), []);
    const { stateRef: frameRef, renderFrame } = useBravaisFrame(frameRefs);
    const wallLook = useBravaisWallLook(reportPlayerOcclusion);
    const view = useBravaisViewport(rootRef);
    const reducedMotion = useReducedMotionFor('lattice');
    // B11：换层的翻牌 / 波次按「降低动态效果」降级成淡入淡出（lattice 或 collectionMorph，见 bravaisMotion）。
    const reducedTransitions = useBravaisReducedTransitions();
    const devicePixelRatio = useDevicePixelRatio();
    const vignette = useLatticeSettingsStore(state => state.latticeVignette);
    const tintEnabled = useLatticeSettingsStore(state => state.latticePosterTintEnabled);
    const tintCustom = useLatticeSettingsStore(state => state.latticePosterTintUseCustomColor);
    const tintColor = useLatticeSettingsStore(state => state.latticePosterTintColor);
    const tintIntensity = useLatticeSettingsStore(state => state.latticePosterTintIntensity);

    // 当前层：首页时是首页层，集合层打开时是顶层；顶层还没到（lazy、交接、回退给 grid）时沿用上一次画的层。
    const home = useBravaisStageStore(state => state.home);
    const top = useBravaisStageStore(state => state.top);
    const previousLayerRef = useRef<BravaisLayer | null>(null);
    const { layer, owned } = resolveCurrentLayer({ depth: navigation.depth, home, top, previous: previousLayerRef.current });
    previousLayerRef.current = layer;

    // B7：缝此刻的开口——等级之上还有表单态、列表面板与命令面板过滤框的临时展开（bravaisSeamTarget）。
    const seamLevel = useBravaisSeamStore(state => state.level);
    const panelFor = useBravaisUiStore(state => state.panelFor);
    const linkedKey = useBravaisUiStore(state => state.linkedKey);
    const isFilterOpen = useAppViewStore(state => state.isCommandFilterOpen);
    const isSearchOpen = useBravaisHomeUiStore(state => state.searchOpen);
    // B10：账户的登录态 / 确认态（account surface 经 bravaisAccountStore 交来）压过层上的一切开口。
    const accountVariant = useBravaisAccountStore(selectBravaisAccountVariant);
    const seamInputFor = useCallback((
        target: BravaisLayer,
        live?: { level: BravaisSeamLevel; panelFor: string | null; filterOpen: boolean; searchOpen: boolean },
    ): BravaisSeamTargetInput => {
        const current = live ?? {
            level: useBravaisSeamStore.getState().level,
            panelFor: useBravaisUiStore.getState().panelFor,
            filterOpen: useAppViewStore.getState().isCommandFilterOpen,
            searchOpen: useBravaisHomeUiStore.getState().searchOpen,
        };
        return {
            surface: target.surface,
            level: current.level,
            viewportWidth: frameRef.current.view?.width ?? window.innerWidth,
            formOpen: Boolean(target.seam.collection?.form),
            panelOpen: current.panelFor === target.key && Boolean(target.entries?.hasPanel),
            filterOpen: current.filterOpen && target.surface !== 'home',
            searchOpen: current.searchOpen,
        };
    }, [frameRef]);
    const seamTarget = layer
        ? resolveStageSeamTarget({
            ...seamInputFor(layer, { level: seamLevel, panelFor, filterOpen: isFilterOpen && owned, searchOpen: isSearchOpen }),
            viewportWidth: view?.width ?? 0,
        }, accountVariant)
        : { width: 0, variant: 'none' as const };
    const openWidthFor = useCallback((target: BravaisLayer) => (
        resolveStageSeamTarget(seamInputFor(target), selectBravaisAccountVariant(useBravaisAccountStore.getState())).width
    ), [seamInputFor]);

    const camera = useBravaisCamera({ frameRef, renderFrame, fieldRef, reducedMotion });
    const seam = useBravaisSeam({
        frameRef,
        renderFrame,
        layer,
        target: seamTarget,
        viewportWidth: view?.width ?? 0,
        contentRef: seamContentRef,
        reducedMotion,
        tweenCamera: camera.tweenTo,
        checkCull: camera.checkCull,
    });
    const { bottomPx, getBottomInset } = useBravaisPlayerSafeArea();

    // 量到视口（或尺寸变了）：写进帧状态，相机保持视图中心不动，重新裁剪；跨过窄屏阈值时缝回到新宽度的默认等级。
    useLayoutEffect(() => {
        if (!view) return;
        frameRef.current.view = view;
        useBravaisSeamStore.getState().syncViewport(view.width);
        camera.moveTo(frameRef.current.center, true);
    }, [camera.moveTo, frameRef, view]);

    const slots = useMemo<readonly WallSlot[]>(() => (
        camera.bounds ? collectWallSlots(expandBounds(camera.bounds, BRAVAIS_OVERSCAN), BRAVAIS_METRICS, FLIP_MAX_TILES) : []
    ), [camera.bounds]);
    const slotsRef = useRef(slots);
    slotsRef.current = slots;

    // 键盘焦点换了：把 slot 换成条目 key 交给层描述（集合页据此写回浏览会话）。
    const displayBridgeRef = useRef<BravaisDisplay | null>(null);
    const onFocusEntry = useCallback((slotKey: string | null) => {
        const current = displayBridgeRef.current;
        const slot = bravaisSlotFromKey(slotKey);
        current?.layer.onFocusEntry?.(slot ? resolveSlotItem(current, slot)?.key ?? null : null);
    }, []);
    const focus = useBravaisFocus({ frameRef, tweenTo: camera.tweenTo, getBottomInset, onFocusEntry });

    const { display, displayRef, isSettling } = useBravaisDisplay(layer, {
        frameRef,
        view,
        wallLook,
        slotsRef,
        navigation,
        reducedTransitions,
        openWidthFor,
        setCameraRange: camera.setRange,
        setAnchor: seam.setAnchor,
        planOpening: seam.planOpening,
        isAnchorOnScreen: seam.isAnchorOnScreen,
        moveTo: camera.moveTo,
        tweenTo: camera.tweenTo,
        collapseFocusCard: focus.collapse,
        getFocusedSlotKey: () => focus.focusedRef.current,
        restoreFocus: key => focus.focusSlot(bravaisSlotFromKey(key)),
    });
    displayBridgeRef.current = displayRef.current;
    // B11 transitions.beforePush：宿主压栈之前，没经过墙上磁贴的打开用键盘焦点所在的 slot 当起点磁贴。
    const getFocusedSlotKey = useCallback(() => focus.focusedRef.current, [focus.focusedRef]);
    useBravaisBeforePush(displayRef, getFocusedSlotKey);

    const interactions = useBravaisInteractions({
        displayRef,
        focus,
        slotsRef,
        frameRef,
        tweenTo: camera.tweenTo,
        rootRef,
        fieldRef,
        seamRef,
    });
    // 透光以墙上此刻显示的档位为准（换档时与翻牌同一次提交）；还没有显示时看偏好。
    const seeThrough = (display?.look ?? wallLook.look) !== 'solid';
    const plates = useBravaisBlockPlates({
        enabled: seeThrough,
        slots,
        display,
        expandedSlotKey: focus.expandedSlotKey,
        reflow: focus.reflow,
        returning: focus.returningBlock,
        anchorX: seam.anchorX,
        reducedMotion,
        fieldRef,
    });

    const active = isInteractive && owned && Boolean(layer?.isInteractive);
    useBravaisKeyboard(active, interactions.handleAction);
    // B7 列表面板：打开是一次导航（写 history，面包屑多「列表」），打开时等级拉回 full；单击一行定位到离缝最近的一份并
    // 聚焦（歌曲直接展开聚焦卡），双击播放。
    const openList = useCallback(() => {
        const current = displayRef.current?.layer;
        if (!current?.entries?.hasPanel) return;
        if (useBravaisSeamStore.getState().level !== 'full') useBravaisSeamStore.getState().setLevel('full');
        openBravaisPanel(current.key);
    }, [displayRef]);
    const panelActions = useMemo<BravaisPanelActions>(() => ({
        close: closeBravaisPanel,
        fold: () => useBravaisSeamStore.getState().setLevel('hidden'),
        locate: itemKey => {
            const current = displayRef.current;
            const { anchorX, center } = frameRef.current;
            const slot = findDisplayItemSlot(current, itemKey, { x: anchorX ?? center.x, y: center.y });
            if (!current || !slot) return;
            const item = resolveSlotItem(current, slot);
            focus.focusSlot(slot, { reveal: item?.kind !== 'track' });
            if (item?.kind === 'track') focus.expand(slot);
        },
        play: itemKey => displayRef.current?.layer.onPlayItem?.(itemKey),
    }), [displayRef, focus.expand, focus.focusSlot, frameRef]);
    // 浏览器后退 / 前进：面板开合跟着 history 记录上的标记走。回到首页（导航栈空了）时面板一定收起。
    useEffect(() => {
        window.addEventListener('popstate', syncPanelWithHistory);
        return () => window.removeEventListener('popstate', syncPanelWithHistory);
    }, []);
    useEffect(() => {
        // 首页层自己的面板（B9 的目录树）不在此列：它跟着首页层与 history 记录走。
        const open = useBravaisUiStore.getState().panelFor;
        if (navigation.depth === 0 && open !== null && open !== useBravaisStageStore.getState().home?.layer.key) {
            useBravaisUiStore.setState({ panelFor: null });
        }
    }, [navigation.depth]);
    // B9 全局搜索框：折叠缝、离开首页层（打开了集合）时关上；stage 卸载（离开首页、换 suite）时也关上。
    useEffect(() => {
        if (seamLevel === 'hidden' || navigation.depth > 0) setBravaisSearchOpen(false);
    }, [navigation.depth, seamLevel]);
    useEffect(() => () => setBravaisSearchOpen(false), []);
    // 过滤框里按 ↓：收起过滤框（过滤词保留），键盘焦点交给墙上的第 1 项（有限拼贴的 rank 0）。
    const { handleAction, focusWall } = interactions;
    useEffect(() => {
        if (!active) return;
        const focusFirst = () => {
            closeCommandFilter();
            focusWall();
            return handleAction({ type: 'first' }, null);
        };
        useBravaisUiStore.setState({ focusFirst });
        return () => {
            if (useBravaisUiStore.getState().focusFirst === focusFirst) useBravaisUiStore.setState({ focusFirst: null });
        };
    }, [active, focusWall, handleAction]);

    useBravaisChromeActions({
        active,
        displayRef,
        frameRef,
        isCollapsed: seam.isCollapsed,
        reopenHere: seam.reopenHere,
        focusSlot: focus.focusSlot,
        openList,
    });

    const setLevel = useCallback((level: BravaisSeamLevel) => useBravaisSeamStore.getState().setLevel(level), []);
    const onSeamTab = useCallback(() => {
        if (useBravaisSeamStore.getState().level === 'hidden') useBravaisSeamStore.getState().restore();
        else seam.reopenHere();
    }, [seam.reopenHere]);

    // 点墙面空白处（不是磁贴）收起聚焦卡；拖动后的残余点击已被 onClickCapture 吞掉。
    const onFieldClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (event.target instanceof Element && event.target.closest('.bravais-tile')) return;
        focus.collapse();
    }, [focus.collapse]);

    const rootClassName = [
        'lattice-root',
        'bravais-root',
        isDaylight ? 'is-daylight' : '',
        vignette ? 'has-vignette' : '',
        tintEnabled ? 'has-poster-tint' : '',
        tintCustom ? 'uses-custom-poster-tint' : '',
        layer?.wall?.loading ? 'is-loading' : '',
        seeThrough ? 'is-see-through' : '',
        seeThrough && BRAVAIS_SEAM_ACRYLIC_BLUR ? 'has-seam-blur' : '',
        display?.layer.seam.home?.manage ? 'is-managing-hidden' : '',
        display?.layer.home?.batch ? 'is-batch' : '',
    ].filter(Boolean).join(' ');

    return (
        <section
            ref={rootRef}
            className={rootClassName}
            style={{
                '--lattice-poster-tint-color': tintColor,
                '--lattice-poster-tint-intensity': tintIntensity,
            } as CSSProperties}
            data-library-stage="bravais"
            data-bravais-layer={display?.layer.key}
            data-bravais-active={active || undefined}
            data-bravais-settling={isSettling || undefined}
            data-bravais-shift={display?.shift?.kind}
            data-bravais-shift-seq={display?.shift?.seq}
            data-bravais-look={display?.look ?? wallLook.look}
            aria-label={t('libraryBravais.wallLabel')}
        >
            <div
                ref={fieldRef}
                className="lattice-field bravais-field"
                tabIndex={-1}
                onPointerDown={camera.pointer.onPointerDown}
                onPointerMove={camera.pointer.onPointerMove}
                onPointerUp={camera.pointer.onPointerUp}
                onPointerCancel={camera.pointer.onPointerCancel}
                onLostPointerCapture={event => {
                    if (event.target === event.currentTarget) camera.pointer.onPointerCancel(event);
                }}
                onClickCapture={camera.pointer.onClickCapture}
                onClick={onFieldClick}
            >
                <BravaisWall
                    slots={view ? slots : []}
                    display={display}
                    anchorX={seam.anchorX}
                    reflow={focus.reflow}
                    returning={focus.returning}
                    expandedSlotKey={focus.expandedSlotKey}
                    focusedSlotKey={focus.focusedSlotKey}
                    linkedKey={panelFor !== null && panelFor === display?.layer.key ? linkedKey : null}
                    pixelScale={(view?.scale ?? 1) * devicePixelRatio}
                    reducedMotion={reducedTransitions}
                    didDragRef={camera.pointer.didDragRef}
                    handlers={interactions.handlers}
                    leftRef={leftRef}
                    rightRef={rightRef}
                    plates={plates}
                />
            </div>
            <BravaisSeam
                seamRef={seamRef}
                contentRef={seamContentRef}
                tabRef={tabRef}
                variant={seam.rendered.variant}
                targetVariant={seamTarget.variant}
                contentWidth={seam.rendered.width}
                layer={seam.rendered.layer}
                currentLayer={layer}
                level={seam.level}
                navigation={navigation}
                bottomPx={bottomPx}
                setLevel={setLevel}
                onTab={onSeamTab}
                openList={openList}
                panel={panelActions}
            />
        </section>
    );
};

export default BravaisStage;

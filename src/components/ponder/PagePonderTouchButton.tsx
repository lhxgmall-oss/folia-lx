import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import { useSupportsFinePointer } from '../../hooks/useSupportsFinePointer';
import { useAppViewStore } from '../../stores/useAppViewStore';
import { usePonderStore } from '../../stores/usePonderStore';
import { useSettingsModalStore } from '../../stores/useSettingsModalStore';
import { openCurrentPagePonder } from '../../services/ponder/pagePonderTarget';
import type { Theme } from '../../types';
import { ponderMotionTokens } from './ponderMotion';
import { ponderLayerTokens, ponderWindowTokens } from './ponderTheme';
import { safeAreaInsets, startSafeAreaInsetTracking } from '../../stores/safeAreaInsets';

// src/components/ponder/PagePonderTouchButton.tsx
// 触屏上代替 Ctrl+G 的入口。
//
// 它贴右上角，不贴右下角：右下角是操作按钮最密的一块地方 —— 底部控制条、集合页那颗
// 列表/搜索按钮、播放页的侧边手柄都挤在那儿，一颗常驻的浮动按钮压上去就是挡路。
//
// 而且它是限时的：落地或换页时露四秒说明自己在，然后自己收起来。想再叫出来就点一下
// 右上角那块热区。这条和面板手柄在触屏上的做法是同一套（UnifiedPanel 的边缘热区）：
// 触屏没有悬停，所以屏幕的角落本身就是入口。
//
// 热区不是一个真实元素，是 window 上一个 passive 监听按坐标判的。摆一个
// pointer-events-auto 的方块在右上角，等于把「挡住右下角」这个问题原样搬到右上角。

/** 露出来之后停留多久。够读一眼，又不至于一直杵在那里。 */
const REVEAL_MS = 4000;

/** 右上角热区的边长，px。按触摸目标给，不按视觉尺寸给。 */
const HOTSPOT_SIZE_PX = 96;

/**
 * 页面自己的控件。右上角常常就有一个（搜索框的右半截、搜索页的关闭按钮、面板的 X）：
 * 手指落在它们上面是在用那个控件，不是在叫灯泡 —— 叫出来的话，同一次触摸的 click 会落到刚露出来、
 * 叠在上面的灯泡上，那个控件就点不动了（安卓上搜索页关不掉，2026-10-18）。
 */
const INTERACTIVE_SELECTOR = 'button, a[href], input, textarea, select, label, [role="button"], [role="tab"], [role="link"], [role="textbox"], [role="searchbox"], [contenteditable=""], [contenteditable="true"]';

const isEditableElement = (element: Element | null): boolean => (
    !!element && (element.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
);

/** 灯泡的边长和它离右上角的距离，和下面的 h-12 w-12 / right-5 top-5 一致。 */
const BUTTON_SIZE_PX = 48;
const BUTTON_INSET_PX = 20;

/**
 * 灯泡可以往下挪的几档（px）。右上角那一格常常正好是页面的控件（首页搜索框的右半截、搜索页的关闭按钮），
 * 往下挪一行通常就是空的（首页的页签那一行、搜索页的来源胶囊那一行都只占左半边）。
 */
const DROP_STEPS_PX = [0, 56, 112] as const;

const isPageControlAt = (x: number, y: number, button: HTMLElement | null): boolean => (
    document.elementsFromPoint(x, y).some(element => {
        if (button && button.contains(element)) {
            return false;
        }
        const control = element.closest(INTERACTIVE_SELECTOR);
        return control !== null && !(button && button.contains(control));
    })
);

/**
 * 灯泡露出来时往下挪多少，才不会盖住页面自己的控件（不算灯泡自己）；哪一档都会盖住就是 null，这时不露。
 * 不在右上角盖住控件，是因为露出来的四秒里那个控件就点不到了。
 */
const findFreeDropPx = (button: HTMLElement | null): number | null => {
    if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') {
        return 0;
    }
    const right = window.innerWidth - BUTTON_INSET_PX - safeAreaInsets.right.get();
    const left = right - BUTTON_SIZE_PX;
    for (const drop of DROP_STEPS_PX) {
        const top = BUTTON_INSET_PX + safeAreaInsets.top.get() + drop;
        const bottom = top + BUTTON_SIZE_PX;
        const probes: Array<[number, number]> = [
            [(left + right) / 2, (top + bottom) / 2],
            [left + 6, top + 6], [right - 6, top + 6], [left + 6, bottom - 6], [right - 6, bottom - 6],
        ];
        if (!probes.some(([x, y]) => isPageControlAt(x, y, button))) {
            return drop;
        }
    }
    return null;
};

type PagePonderTouchButtonProps = {
    theme?: Theme;
    isDaylight: boolean;
};

/** Touch-only equivalent of Ctrl+G. It deliberately has no component-target API. */
const PagePonderTouchButton: React.FC<PagePonderTouchButtonProps> = ({ theme, isDaylight }) => {
    const { t } = useTranslation();
    const calm = useReducedMotionFor('uiMicroMotion');
    const isCoarsePointer = !useSupportsFinePointer();
    const hasSession = usePonderStore(state => state.session !== null);
    const isOnboardingOpen = useSettingsModalStore(state => state.isUserGuideModalOpen);
    const showTouchButton = usePonderStore(state => state.showPonderTouchButton);
    const view = useAppViewStore(state => state.view);

    const [isRevealed, setIsRevealed] = useState(false);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    /** 露出来时往下挪了多少（findFreeDropPx）；热区跟着往下延伸同样的量。 */
    const [dropPx, setDropPx] = useState(0);
    const dropPxRef = useRef(0);
    const hideTimerRef = useRef<number | null>(null);
    // 监听器里要读当前的显隐，但它不该因为显隐变化就解绑重绑。
    const isRevealedRef = useRef(isRevealed);
    isRevealedRef.current = isRevealed;
    /**
     * 「这一下是把它叫出来的，不是按它」。
     *
     * 热区和按钮占的是同一块地方：隐藏时按钮 pointer-events-none，所以 pointerdown 落到底下，
     * 热区把它露出来；可同一次触摸的 click 是在那之后才派发的，那时按钮已经可点了，
     * 于是一下变成两件事 —— 叫出来，然后立刻进了教程。这面旗就是用来吃掉那一次 click 的。
     */
    const suppressNextClickRef = useRef(false);

    /** 露出来四秒；右上角那一格（往下几档也一样）压着页面控件时不露，返回 false。 */
    const reveal = useCallback((): boolean => {
        const drop = findFreeDropPx(buttonRef.current);
        if (drop === null) {
            return false;
        }
        dropPxRef.current = drop;
        setDropPx(drop);
        setIsRevealed(true);
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
        }
        hideTimerRef.current = window.setTimeout(() => {
            hideTimerRef.current = null;
            setIsRevealed(false);
        }, REVEAL_MS);
        return true;
    }, []);

    const conceal = useCallback(() => {
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }
        setIsRevealed(false);
    }, []);

    // 换页时重新露一次：这颗按钮讲的是「思索当前页面」，页面换了就值得再说一遍自己在。
    // 但不盖住新页面右上角的控件（搜索页的关闭按钮）：那一格有控件就往下挪，挪不开就不露（见 reveal）。
    // 等一下再看，新页面要先画出来；正在打字时也不露。
    useEffect(() => {
        if (!isCoarsePointer || !showTouchButton) {
            return undefined;
        }
        startSafeAreaInsetTracking();
        const timer = window.setTimeout(() => {
            if (isEditableElement(document.activeElement) || !reveal()) {
                conceal();
            }
        }, 350);
        return () => {
            window.clearTimeout(timer);
            if (hideTimerRef.current !== null) {
                window.clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
            }
        };
    }, [conceal, isCoarsePointer, reveal, showTouchButton, view]);

    // 开始打字（搜索框拿到焦点）就收起来：键盘弹起后视口变矮，右上角那块全是搜索栏。
    useEffect(() => {
        if (!isCoarsePointer || !showTouchButton || typeof document === 'undefined') {
            return undefined;
        }
        const handleFocusIn = (event: FocusEvent) => {
            if (isEditableElement(event.target as Element | null)) {
                conceal();
            }
        };
        document.addEventListener('focusin', handleFocusIn);
        return () => document.removeEventListener('focusin', handleFocusIn);
    }, [conceal, isCoarsePointer, showTouchButton]);

    // 右上角热区。按坐标判而不是摆一个元素：摆元素就会挡住底下的东西，
    // 而「不挡路」正是这颗按钮从右下角搬过来的全部理由。
    useEffect(() => {
        if (!isCoarsePointer || !showTouchButton || typeof window === 'undefined') {
            return undefined;
        }

        const handlePointerDown = (event: PointerEvent) => {
            if (event.pointerType !== 'touch') {
                return;
            }

            const inHotspot = event.clientY <= HOTSPOT_SIZE_PX + safeAreaInsets.top.get() + dropPxRef.current
                && event.clientX >= window.innerWidth - HOTSPOT_SIZE_PX - safeAreaInsets.right.get();
            const target = event.target instanceof Element ? event.target : null;
            const onPageControl = !!target
                && target.closest(INTERACTIVE_SELECTOR) !== null
                && !(buttonRef.current && buttonRef.current.contains(target));
            if (!inHotspot || onPageControl) {
                // 手指落在别处，上一面没用掉的旗就作废 —— 免得它留到下一次真正的点击上。
                suppressNextClickRef.current = false;
                return;
            }

            // 按钮已经露着的时候，这一下就是在按它，不该吃掉。
            if (isRevealedRef.current) {
                suppressNextClickRef.current = false;
                reveal();
                return;
            }
            suppressNextClickRef.current = reveal();
        };

        window.addEventListener('pointerdown', handlePointerDown, { passive: true, capture: true });
        return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    }, [isCoarsePointer, reveal, showTouchButton]);

    if (!isCoarsePointer || !showTouchButton || hasSession || isOnboardingOpen) {
        return null;
    }

    return (
        <button
            type="button"
            ref={buttonRef}
            data-testid="page-ponder-touch-button"
            data-ponder-touch-revealed={isRevealed || undefined}
            onClick={() => {
                if (suppressNextClickRef.current) {
                    suppressNextClickRef.current = false;
                    return;
                }
                openCurrentPagePonder();
            }}
            aria-label={t('ponder.openPage')}
            // 收起来之后不可点：留着可点的话，右上角会变成一块看不见却能按的地方。
            // 出来时淡入、从略小长到位；关了微动效就只淡入淡出。
            className={`fixed right-[calc(1.25rem+var(--lx-safe-right,0px))] top-[calc(1.25rem+var(--lx-safe-top,0px))] z-[190] h-12 w-12 rounded-full transition-[opacity,transform] active:scale-95 ${
                isRevealed ? 'pd-t-enter opacity-100' : `pd-t-base pointer-events-none opacity-0 ${calm ? '' : 'scale-[0.94]'}`
            }`}
            style={{ ...ponderLayerTokens(isDaylight, theme), ...ponderMotionTokens(calm), marginTop: dropPx || undefined }}
        >
            <span
                className="grid h-full w-full place-items-center rounded-full bg-[var(--st-card)] text-[color:var(--st-t1)] shadow-[0_0_0_1px_var(--st-line),0_8px_20px_rgba(0,0,0,0.25)]"
                style={ponderWindowTokens(isDaylight, theme, calm)}
            >
                <Lightbulb size={20} aria-hidden="true" />
            </span>
        </button>
    );
};

export default PagePonderTouchButton;

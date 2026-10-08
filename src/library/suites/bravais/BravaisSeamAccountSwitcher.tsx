import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { LogIn, LogOut, Plug } from 'lucide-react';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import type { BravaisHomeAccount } from './bravaisHomeModels';
import { resolveBravaisAccountPopMotion } from './bravaisAccountMotion';
import { closeBravaisHomePopover, setBravaisHomeOpenRequest, setBravaisHomePopover, useBravaisHomeUiStore } from './bravaisHomeUiStore';
import BravaisProviderAvatar from './BravaisProviderAvatar';
import './bravaisAccount.css';

// src/library/suites/bravais/BravaisSeamAccountSwitcher.tsx
// 首页在线页签窄缝里的平台切换（B10，设计稿 §10.7 的 account-select / account-logout）：当前平台 + 账户状态的按钮，
// 点开是 provider 列表（当前标记、账户状态、选它会做什么），当前且已登录的那一行有登出（canLogoutProvider，登出在途时
// 禁用）。未登录（guest）时墙是空的，这里就是这个页签的登录入口。选一个平台走 account.selectProvider：能直接切的
// 缝翻成确认态，要登录的缝拉到完整宽度翻成登录态——列表随之收起。书脊上只留一个图标按钮，点它把缝展开成窄缝。
// 数据与回调都来自层描述（BravaisHomeAccount，首页在线来源投影好的），这里只排版与管列表的开合。
// fb3（用户实测：未登录时五个平台直接摊开太占地方）：未登录也不再常开列表，只显示一个「连接在线平台」入口，点了才
// 展开平台列表（行与已登录时一样：平台名、账户状态、登录到 X / 切换至 X）；再点入口或 Esc 收起。已登录时不变。
// data-bravais-account：已登录 closed / panel，未登录 guest（只有入口）/ guest-panel（列表展开）。
// 书脊上的账户按钮先把缝展开成窄缝，再经 bravaisHomeUiStore 的 openRequest 让窄缝里的列表打开。
// fb4（用户实测）：入口挪到窄缝底部、贴在工具格正上方（BravaisSeamHome），列表从按钮**往上**弹出，绝对定位盖在导航区
// 上，不推挤页签、不改变页签的缩减级别。弹出 / 收起用 framer-motion（bravaisAccountMotion：从按钮方向放大 + 位移 +
// 渐显；降低动态效果时只渐变）。再点按钮、Esc、点别处都收起。登出不再单独一行，是当前那一行右侧的小图标按钮
// （LogOut，aria-label / title 是登出文案）；行本身点击仍是选该平台。
// fb8（用户实测）：入口与列表行改成 grid 账户切换器的样子——图标 / 头像 + 名称（BravaisProviderAvatar，徽章与 grid 同一套）：
// - 入口：已登录是头像 + 昵称（没头像退回平台徽章）；无需登录的平台是徽章 + 平台名；未登录是连接图标 + 「连接在线平台」。
//   不再显示「未登录 / 未配置 / 登录到 X」之类的状态字，平台名与账户状态挪进 aria-label / title。
// - 列表行：头像 / 徽章 + 平台名，下面一行小字只留区分所必需的（昵称、「无需登录」「未配置」，与 grid 一致）；要登录才能
//   选的行尾是 LogIn 图标（同 grid），「登录到 X / 切换至 X」与完整状态进行的 aria-label / title。登出图标不变。
// - 列表与工具格的「⋯」菜单互斥：开着哪个记在 bravaisHomeUiStore 的 popover。

/** 列表离首页窄缝顶端至少留这么多（列表比可用高度高时在里面滚）。 */
const LIST_TOP_GAP = 12;

/** 列表行的可访问名与 title：平台名 · 账户状态 · 选它会做什么（界面上只显示平台名与必要的小字）。 */
const describeRow = (row: BravaisHomeAccount['rows'][number]) => [row.label, row.detail, row.actionLabel].filter(Boolean).join(' · ');

/**
 * 弹出的平台列表。收起动画途中（useIsPresent 为 false）挂 inert，不再接点击与焦点。
 * `maxHeight` 是按钮上沿到首页窄缝顶端的可用高度（打开时量一次）。
 */
const BravaisAccountList: React.FC<{
    account: BravaisHomeAccount;
    reduced: boolean;
    maxHeight: number | null;
    onClose: () => void;
}> = ({ account, reduced, maxHeight, onClose }) => {
    const present = useIsPresent();
    const pop = resolveBravaisAccountPopMotion(reduced);
    return (
        <motion.div
            className="bravais-account-list"
            role="menu"
            aria-label={account.title}
            data-bravais-account-list
            inert={!present}
            initial={pop.initial}
            animate={pop.animate}
            exit={pop.exit}
            transition={pop.transition}
            style={{ transformOrigin: pop.transformOrigin, maxHeight: maxHeight ?? undefined }}
        >
            {account.rows.map(row => (
                <div
                    key={row.providerId}
                    className={`bravais-account-row${row.current ? ' is-current' : ''}`}
                    data-bravais-account-provider={row.providerId}
                    data-current={row.current ? 'true' : undefined}
                    data-direct={row.direct ? 'true' : undefined}
                >
                    <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={row.current}
                        disabled={!row.configured}
                        aria-label={describeRow(row)}
                        title={describeRow(row)}
                        onClick={() => {
                            onClose();
                            account.onSelect(row.providerId);
                        }}
                    >
                        <BravaisProviderAvatar providerId={row.providerId} name={row.label} avatarUrl={row.avatarUrl} />
                        <span className="is-text">
                            <span className="is-name">{row.label}</span>
                            {row.note && <span className="is-note">{row.note}</span>}
                        </span>
                        {row.configured && !row.direct && <LogIn aria-hidden className="is-login" />}
                    </button>
                    {row.logout && (
                        <button
                            type="button"
                            className="bravais-account-logout"
                            data-bravais-account-logout={row.providerId}
                            disabled={row.logout.disabled}
                            aria-label={row.logout.label}
                            title={row.logout.label}
                            onClick={() => {
                                onClose();
                                account.onLogout(row.providerId);
                            }}
                        >
                            <LogOut aria-hidden />
                        </button>
                    )}
                </div>
            ))}
        </motion.div>
    );
};

const BravaisSeamAccountSwitcher: React.FC<{
    account: BravaisHomeAccount;
    compact: boolean;
    /** 书脊上点账户按钮：把缝展开成窄缝。 */
    onExpand: () => void;
}> = ({ account, compact, onExpand }) => {
    const open = useBravaisHomeUiStore(state => state.popover === 'accounts');
    const [maxHeight, setMaxHeight] = useState<number | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const request = useBravaisHomeUiStore(state => state.openRequest);
    // bravais 的缝与悬停沿用「队列拼贴」的降级；弹出菜单也算界面微动效：任一降级都只做渐变。
    const reducedLattice = useReducedMotionFor('lattice');
    const reducedMicro = useReducedMotionFor('uiMicroMotion');
    const reduced = reducedLattice || reducedMicro;
    const shown = open && !compact;
    const toggle = () => setBravaisHomePopover(open ? null : 'accounts');

    // 卸载时收起自己开着的列表（只收这个实例开着的：书脊翻成窄缝时旧的书脊实例后卸载，不能把新开的收掉）。
    const shownRef = useRef(false);
    shownRef.current = shown;
    useEffect(() => () => {
        if (shownRef.current) closeBravaisHomePopover('accounts');
    }, []);

    // 书脊上点了账户按钮：缝展开成窄缝后在这里把列表打开。书脊上的按钮已经随翻转换掉了，焦点挪到窄缝的入口上。
    useEffect(() => {
        if (compact || request !== 'accounts') return;
        setBravaisHomeOpenRequest(null);
        setBravaisHomePopover('accounts');
        rootRef.current?.querySelector<HTMLElement>('[data-bravais-account-toggle]')?.focus({ preventScroll: true });
    }, [compact, request]);

    // 打开时量一次可用高度：按钮上沿到首页窄缝顶端（列表往上弹，不能顶出缝）。
    useLayoutEffect(() => {
        if (!shown) return;
        const root = rootRef.current;
        const home = root?.closest('[data-bravais-home-seam]');
        if (!root || !home) return;
        const room = root.getBoundingClientRect().top - home.getBoundingClientRect().top - LIST_TOP_GAP;
        setMaxHeight(Math.max(0, Math.floor(room)));
    }, [shown]);

    // 列表开着时点别处收起（缝里、墙上都算）；Esc 先收起它（焦点不一定在入口上——书脊展开时按钮换掉了——所以挂在
    // document 上；墙的 Esc 阶梯挂在 window 上、认 defaultPrevented，preventDefault 让它跳过这次按键）。
    useEffect(() => {
        if (!shown) return undefined;
        const onPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
            closeBravaisHomePopover('accounts');
        };
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            event.preventDefault();
            closeBravaisHomePopover('accounts');
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [shown]);

    // 入口上显示的名字：已登录是昵称，无需登录的平台是平台名。状态（平台名 · 账户状态）进 aria-label / title。
    const status = [account.providerLabel, account.detail].filter(Boolean).join(' · ');
    const entryName = account.nickname ?? account.providerLabel;
    const avatar = <BravaisProviderAvatar providerId={account.providerId} name={account.providerLabel} avatarUrl={account.avatarUrl} />;
    const connectIcon = <span className="bravais-account-avatar is-connect" aria-hidden data-bravais-account-avatar="connect"><Plug /></span>;

    if (compact) {
        const label = account.guest ? `${account.connectLabel} · ${status}` : `${account.toggleLabel} · ${status}`;
        return (
            <div className="bravais-account-switcher is-compact">
                <button type="button" className="bravais-seam-icon bravais-account-spine" data-bravais-account-toggle="compact"
                    aria-label={label} title={label}
                    onClick={() => {
                        setBravaisHomeOpenRequest('accounts');
                        onExpand();
                    }}>
                    {account.guest ? connectIcon : avatar}
                </button>
            </div>
        );
    }

    const state = account.guest ? (open ? 'guest-panel' : 'guest') : open ? 'panel' : 'closed';
    return (
        <div ref={rootRef} className={`bravais-account-switcher${account.guest ? ' is-guest' : ''}`} data-bravais-account={state}>
            <AnimatePresence>
                {shown && <BravaisAccountList key="list" account={account} reduced={reduced} maxHeight={maxHeight} onClose={() => closeBravaisHomePopover('accounts')} />}
            </AnimatePresence>
            {account.guest ? (
                <button type="button" className="bravais-account-entry bravais-account-connect" data-bravais-account-toggle="connect"
                    aria-haspopup="menu" aria-expanded={open} aria-label={`${account.connectLabel} · ${status}`} title={`${account.connectLabel} · ${status}`}
                    onClick={toggle}>
                    {connectIcon}
                    <span className="is-name">{account.connectLabel}</span>
                </button>
            ) : (
                <button type="button" className="bravais-account-entry bravais-account-toggle" data-bravais-account-toggle="strip"
                    aria-haspopup="menu" aria-expanded={open} aria-label={`${account.toggleLabel} · ${status}`}
                    title={`${account.toggleLabel} · ${status}`} onClick={toggle}>
                    {avatar}
                    <span className="is-name">{entryName}</span>
                </button>
            )}
        </div>
    );
};

export default BravaisSeamAccountSwitcher;

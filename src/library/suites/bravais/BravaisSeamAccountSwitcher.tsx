import React, { useEffect, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Plug, UserRound } from 'lucide-react';
import type { BravaisHomeAccount } from './bravaisHomeModels';
import { setBravaisHomeOpenRequest, useBravaisHomeUiStore } from './bravaisHomeUiStore';
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

const BravaisSeamAccountSwitcher: React.FC<{
    account: BravaisHomeAccount;
    compact: boolean;
    /** 书脊上点账户按钮：把缝展开成窄缝。 */
    onExpand: () => void;
}> = ({ account, compact, onExpand }) => {
    const [open, setOpen] = useState(false);
    const request = useBravaisHomeUiStore(state => state.openRequest);

    // 书脊上点了账户按钮：缝展开成窄缝后在这里把列表打开。
    useEffect(() => {
        if (compact || request !== 'accounts') return;
        setBravaisHomeOpenRequest(null);
        setOpen(true);
    }, [compact, request]);

    if (compact) {
        const label = account.guest ? account.connectLabel : account.toggleLabel;
        return (
            <div className="bravais-account-switcher is-compact">
                <button type="button" className="bravais-seam-icon" data-bravais-account-toggle="compact"
                    aria-label={label} title={account.guest ? label : `${account.providerLabel} · ${account.detail}`}
                    onClick={() => {
                        setBravaisHomeOpenRequest('accounts');
                        onExpand();
                    }}>
                    {account.guest ? <Plug aria-hidden /> : <UserRound aria-hidden />}
                </button>
            </div>
        );
    }

    // 列表开着时 Esc 先收起它（墙的 Esc 阶梯不认识这个列表；preventDefault 让墙跳过这次按键）。
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        setOpen(false);
    };

    const state = account.guest ? (open ? 'guest-panel' : 'guest') : open ? 'panel' : 'closed';
    return (
        <div className={`bravais-account-switcher${account.guest ? ' is-guest' : ''}`} data-bravais-account={state} onKeyDown={onKeyDown}>
            {account.guest ? (
                <button type="button" className="bravais-account-connect" data-bravais-account-toggle="connect"
                    aria-haspopup="menu" aria-expanded={open} title={account.connectLabel} onClick={() => setOpen(value => !value)}>
                    <Plug aria-hidden />
                    <span className="is-name">{account.connectLabel}</span>
                    <ChevronDown aria-hidden className="is-chevron" />
                </button>
            ) : (
                <button type="button" className="bravais-account-toggle" data-bravais-account-toggle="strip"
                    aria-haspopup="menu" aria-expanded={open} aria-label={account.toggleLabel}
                    title={`${account.providerLabel} · ${account.detail}`} onClick={() => setOpen(value => !value)}>
                    <span className="is-name">{account.providerLabel}<ChevronDown aria-hidden /></span>
                    <span className="is-detail">{account.detail}</span>
                </button>
            )}
            {open && (
                <div className="bravais-account-list" role="menu" aria-label={account.title}>
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
                                title={row.actionLabel || row.label}
                                onClick={() => {
                                    setOpen(false);
                                    account.onSelect(row.providerId);
                                }}
                            >
                                <span className="is-name">{row.label}</span>
                                <span className="is-detail">{row.detail}</span>
                                {row.actionLabel && <span className="is-action">{row.actionLabel}</span>}
                            </button>
                            {row.logout && (
                                <button
                                    type="button"
                                    className="bravais-account-logout"
                                    data-bravais-account-logout={row.providerId}
                                    disabled={row.logout.disabled}
                                    onClick={() => {
                                        setOpen(false);
                                        account.onLogout(row.providerId);
                                    }}
                                >
                                    {row.logout.label}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default BravaisSeamAccountSwitcher;

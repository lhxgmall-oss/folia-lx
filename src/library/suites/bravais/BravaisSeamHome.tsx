import React, { useState } from 'react';
import {
    Check,
    Disc3,
    EyeOff,
    FoldHorizontal,
    FolderTree,
    ListMusic,
    Maximize2,
    MonitorPlay,
    MoreHorizontal,
    RefreshCw,
    Search,
    Settings,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer } from './bravaisLayer';
import type { BravaisHomeAccount, BravaisHomeToolId } from './bravaisHomeModels';
import type { BravaisSeamLevel } from './bravaisSeamLevel';
import BravaisSeamAccountSwitcher from './BravaisSeamAccountSwitcher';
import './bravaisHome.css';

// src/library/suites/bravais/BravaisSeamHome.tsx
// 首页窄缝 / 首页书脊（设计稿 §5「开合」、§10.5）：折叠、竖排「书库」、页签（五个一级页签，竖排并列成一排书脊）、
// 二级切换（本地四行、Navidrome 的 section——切换整面翻牌，不换层）、管理隐藏视图的开关、扫描进度、给 B10 留的账户位，
// 底部一格格的工具按钮（搜索、目录、管理隐藏、Navidrome 刷新、队列 / 播放页 / 舞台 / 设置）与本地「⋯」。
// 文案都来自层描述（已翻译），回调都是 surface 给的；这里只排版。

const TOOL_ICONS: Record<BravaisHomeToolId, React.ComponentType<{ 'aria-hidden'?: boolean; className?: string }>> = {
    search: Search,
    directory: FolderTree,
    'manage-hidden': EyeOff,
    'refresh-navidrome': RefreshCw,
    queue: ListMusic,
    player: Disc3,
    stage: MonitorPlay,
    settings: Settings,
};

/**
 * B10 账户位：首页在线页签窄缝里的平台切换（account-select / account-logout）放在这里。B9 只给一个空容器，挂着
 * `data-bravais-account-slot=<providerId>`；B10 按 BravaisHomeAccount（扩展它）在里面渲染平台列表与登出。
 * B10：容器里是 BravaisSeamAccountSwitcher（书脊上是一个展开缝的图标按钮）。
 */
export const BravaisSeamAccountSlot: React.FC<{ account: BravaisHomeAccount; compact: boolean; onExpand: () => void }> = ({ account, compact, onExpand }) => (
    <div className="bravais-seam-account" data-bravais-account-slot={account.providerId} aria-label={account.providerLabel}>
        <BravaisSeamAccountSwitcher account={account} compact={compact} onExpand={onExpand} />
    </div>
);

const BravaisSeamHome: React.FC<{
    layer: BravaisLayer;
    compact: boolean;
    setLevel: (level: BravaisSeamLevel) => void;
}> = ({ layer, compact, setLevel }) => {
    const { t } = useTranslation();
    const [menuOpen, setMenuOpen] = useState(false);
    const { seam } = layer;
    const home = seam.home;
    return (
        <div className={`bravais-seam-home${compact ? ' is-compact' : ''}`} data-bravais-home-seam>
            <button type="button" className="bravais-seam-icon" data-bravais-seam-action="hide" onClick={() => setLevel('hidden')}
                aria-label={t('libraryBravais.seamFold')} title={t('libraryBravais.seamFold')}>
                <FoldHorizontal aria-hidden />
            </button>
            <div className="bravais-seam-vtitle" style={{ fontSize: compact ? 26 : 40 }}>{seam.title}</div>
            {seam.tabs && seam.tabs.length > 0 && (
                <div className="bravais-seam-tabs" role="tablist" aria-label={seam.title}>
                    {seam.tabs.map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            role="tab"
                            aria-selected={tab.active}
                            disabled={tab.disabled}
                            data-bravais-tab={tab.key}
                            className={tab.active ? 'is-active' : undefined}
                            onClick={() => seam.onSelectTab?.(tab.key)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            )}
            {home?.sections && home.sections.length > 0 && (
                <div className="bravais-seam-sections" role="tablist" aria-label={seam.meta}>
                    {home.sections.map(section => (
                        <button
                            key={section.key}
                            type="button"
                            role="tab"
                            aria-selected={section.active}
                            data-bravais-section={section.key}
                            className={section.active ? 'is-active' : undefined}
                            onClick={() => home.onSelectSection?.(section.key)}
                        >
                            {section.label}
                        </button>
                    ))}
                </div>
            )}
            {home?.manage && (
                <div className="bravais-seam-manage" data-bravais-manage={home.manage.mode}>
                    <span>{home.manage.title}</span>
                    <button type="button" aria-pressed={home.manage.mode === 'manage-hidden-only'} data-bravais-seam-action="hidden-only"
                        className={home.manage.mode === 'manage-hidden-only' ? 'is-active' : undefined} onClick={home.manage.onToggleHiddenOnly}>
                        {home.manage.mode === 'manage-hidden-only' && <Check aria-hidden />}{home.manage.hiddenOnlyLabel}
                    </button>
                    <button type="button" data-bravais-seam-action="manage-done" onClick={home.manage.onDone}>{home.manage.doneLabel}</button>
                </div>
            )}
            {/* 元数据行：平时是来源（在线平台名 / 本地 / Navidrome），本地导入 / 重扫时换成扫描进度。 */}
            {home?.scan
                ? <div className="bravais-seam-scan" data-bravais-scan>{home.scan}</div>
                : seam.meta && <div className="bravais-seam-scan">{seam.meta}</div>}
            {home?.account && <BravaisSeamAccountSlot account={home.account} compact={compact} onExpand={() => setLevel('full')} />}
            <div className="bravais-seam-spacer" />
            {seam.status && <div className="bravais-seam-vstatus" data-bravais-seam-status>{seam.status}</div>}
            {home && (
                <div className="bravais-seam-tools">
                    {home.tools.map(tool => {
                        const Icon = TOOL_ICONS[tool.id];
                        return (
                            <button
                                key={tool.id}
                                type="button"
                                className={`bravais-seam-icon${tool.pressed ? ' is-pressed' : ''}`}
                                data-bravais-seam-action={tool.id}
                                aria-label={tool.label}
                                aria-pressed={tool.pressed}
                                title={tool.label}
                                disabled={tool.disabled}
                                onClick={tool.run}
                            >
                                <Icon aria-hidden className={tool.busy ? 'animate-spin' : undefined} />
                            </button>
                        );
                    })}
                    {home.menu && home.menu.length > 0 && (
                        <button type="button" className="bravais-seam-icon" data-bravais-seam-action="more" aria-expanded={menuOpen}
                            aria-label={home.menuLabel} title={home.menuLabel} onClick={() => setMenuOpen(open => !open)}>
                            <MoreHorizontal aria-hidden />
                        </button>
                    )}
                </div>
            )}
            {menuOpen && home?.menu && (
                <div className="bravais-seam-menu is-home" role="menu" data-bravais-seam-menu>
                    {home.menu.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            role="menuitem"
                            disabled={item.disabled}
                            data-bravais-seam-action={item.id}
                            onClick={() => {
                                setMenuOpen(false);
                                item.run();
                            }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
            {compact && (
                <button type="button" className="bravais-seam-icon" data-bravais-seam-action="expand" onClick={() => setLevel('full')}
                    aria-label={t('libraryBravais.seamExpand')} title={t('libraryBravais.seamExpand')}>
                    <Maximize2 aria-hidden />
                </button>
            )}
        </div>
    );
};

export default BravaisSeamHome;

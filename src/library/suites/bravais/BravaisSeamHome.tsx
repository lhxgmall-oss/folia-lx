import React, { useMemo, useRef } from 'react';
import { Check, FoldHorizontal, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer, BravaisSeamTab } from './bravaisLayer';
import type { BravaisHomeAccount } from './bravaisHomeModels';
import type { BravaisSeamLevel } from './bravaisSeamLevel';
import BravaisSeamAccountSwitcher from './BravaisSeamAccountSwitcher';
import BravaisSeamHomeTools from './BravaisSeamHomeTools';
import { abbreviateSeamTabLabels } from './bravaisSeamTabLabels';
import { useBravaisSeamTabsFit } from './useBravaisSeamTabsFit';
import './bravaisHome.css';

// src/library/suites/bravais/BravaisSeamHome.tsx
// 首页窄缝 / 首页书脊（设计稿 §5「开合」、§10.5）：折叠、竖排「书库」、页签（五个一级页签，竖排并列成一排书脊）、
// 二级切换（本地四行、Navidrome 的 section——切换整面翻牌，不换层）、管理隐藏视图的开关、扫描进度、给 B10 留的账户位，
// 底部一格格的工具按钮（搜索、目录、管理隐藏、Navidrome 刷新、队列 / 播放页 / 舞台 / 设置）与本地「⋯」。
// 文案都来自层描述（已翻译），回调都是 surface 给的；这里只排版。
// fb2 重排（用户实测：120px 里太挤、底部图标挤成一团）：
// - 从上到下：导航区（页头 + 二级切换 + 管理隐藏，唯一可伸缩的一段，放不下时可滚）→ 扫描进度 → 账户位 → 状态
//   → 工具格（BravaisSeamHomeTools：常驻图标两列，次要的收进「⋯」）。各段是自然高度、互不重叠，
//   整体在播放条安全区之上（缝内容的底部内边距）。
// - 页头：页签竖排（writing-mode: vertical-rl，与缝里竖排标题同一套排版语言），一列一个页签。最上面一行是「书库」
//   小字；窄缝里折叠按钮在页签那一列右边，书脊上在页签上面。
// - 纵向放不下全名时页签缩成一个字（bravaisSeamTabLabels），按测量决定（useBravaisSeamTabsFit），全名留在
//   title / aria-label。
// - fb2 第二轮：「书库」是页头最上面一行小字，折叠按钮紧挨在它下面。缩减顺序：先视觉隐藏这行标题（读屏仍读得到，
//   页签列的 aria-label 也是它）→ 再把页签缩成一个字 → 再不够导航区在里面滚。三级都按测量（useBravaisSeamTabsFit）。

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

/**
 * 页头：标题与竖排页签（真按钮），或它的全名测量副本（span，不可聚焦、不进无障碍树）。`lead` 是页签那一列旁边的
 * 东西（折叠按钮；测量副本里是同尺寸的占位）：窄缝里排在页签列右边、与页签同一行起头，书脊上排在页签上面。
 * fb2 第二轮（用户看了截图）：「书库」改成页头最上面一行小字（横排），不再与页签列并排占一大块；折叠按钮紧挨在它
 * 下面、页签那一列的右边（书脊上在页签上面）。空间不够时先隐藏这行标题（`hideTitle`：视觉隐藏，读屏仍读得到），
 * 再不够才把页签缩成一个字。
 */
const HomeSeamHead: React.FC<{
    title: string;
    hideTitle: boolean;
    tabs: readonly BravaisSeamTab[];
    shorts: readonly string[] | null;
    lead: React.ReactNode;
    onSelectTab?: (key: string) => void;
    measure?: boolean;
}> = ({ title, hideTitle, tabs, shorts, lead, onSelectTab, measure = false }) => (
    <div className="bravais-seam-home-head">
        <div className={`bravais-seam-home-title${hideTitle ? ' is-hidden' : ''}`} data-bravais-home-title={measure ? undefined : hideTitle ? 'hidden' : 'shown'}>
            {title}
        </div>
        <div className="bravais-seam-home-side">
            {lead}
            {tabs.length > 0 && (measure ? (
                <div className="bravais-seam-tabs">
                    {tabs.map(tab => <span key={tab.key} className="bravais-seam-home-tab">{tab.label}</span>)}
                </div>
            ) : (
                <div className={`bravais-seam-tabs${shorts ? ' is-short' : ''}`} role="tablist" aria-label={title} aria-orientation="vertical">
                    {tabs.map((tab, index) => (
                        <button
                            key={tab.key}
                            type="button"
                            role="tab"
                            aria-selected={tab.active}
                            aria-label={shorts ? tab.label : undefined}
                            title={tab.label}
                            disabled={tab.disabled}
                            data-bravais-tab={tab.key}
                            data-bravais-tab-short={shorts ? 'true' : undefined}
                            className={`bravais-seam-home-tab${tab.active ? ' is-active' : ''}`}
                            onClick={() => onSelectTab?.(tab.key)}
                        >
                            {shorts ? shorts[index] : tab.label}
                        </button>
                    ))}
                </div>
            ))}
        </div>
    </div>
);

const BravaisSeamHome: React.FC<{
    layer: BravaisLayer;
    compact: boolean;
    setLevel: (level: BravaisSeamLevel) => void;
}> = ({ layer, compact, setLevel }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const home = seam.home;
    const tabs = seam.tabs ?? [];
    const navRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const headRef = useRef<HTMLDivElement>(null);
    const titledHeadRef = useRef<HTMLDivElement>(null);
    const bareHeadRef = useRef<HTMLDivElement>(null);
    const { level, overflowing } = useBravaisSeamTabsFit({ navRef, contentRef, headRef, titledHeadRef, bareHeadRef });
    const short = level === 'short';
    const labelsKey = tabs.map(tab => tab.label).join('\u0000');
    const shortLabels = useMemo(() => abbreviateSeamTabLabels(labelsKey.split('\u0000')), [labelsKey]);
    // 元数据行：平时是来源（在线平台名 / 本地 / Navidrome），本地导入 / 重扫时换成扫描进度。
    // fb2：来源名与账户位（在线平台名）、当前页签（本地 / Navidrome）重复，窄缝里纵向空间最紧，平时不画，只在扫描时
    // 显示进度；页签缩成一个字时全名在页签的 title / aria-label 里。
    const meta = home?.scan ? <div className="bravais-seam-scan" data-bravais-scan>{home.scan}</div> : null;
    const foldButton = (
        <button type="button" className="bravais-seam-icon" data-bravais-seam-action="hide" onClick={() => setLevel('hidden')}
            aria-label={t('libraryBravais.seamFold')} title={t('libraryBravais.seamFold')}>
            <FoldHorizontal aria-hidden />
        </button>
    );
    return (
        <div className={`bravais-seam-home${compact ? ' is-compact' : ''}${short ? ' has-short-tabs' : ''}`} data-bravais-home-seam
            data-bravais-home-fit={level}>
            <div ref={navRef} className={`bravais-seam-home-nav${overflowing ? ' is-overflowing' : ''}`}>
                <div ref={contentRef} className="bravais-seam-home-nav-content">
                    <div ref={headRef}>
                        <HomeSeamHead title={seam.title} hideTitle={level !== 'titled'} tabs={tabs} shorts={short ? shortLabels : null}
                            lead={foldButton} onSelectTab={seam.onSelectTab} />
                    </div>
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
                </div>
            </div>
            {/* 全名页头的测量副本：与页头同宽、绝对定位不占位（useBravaisSeamTabsFit 量它）。
                fb2 第二轮：两份——带标题的全名页头、不带标题的全名页头。 */}
            <div ref={titledHeadRef} className="bravais-seam-home-measure" aria-hidden>
                <HomeSeamHead title={seam.title} hideTitle={false} tabs={tabs} shorts={null} measure
                    lead={<span className="bravais-seam-icon" />} />
            </div>
            <div ref={bareHeadRef} className="bravais-seam-home-measure" aria-hidden>
                <HomeSeamHead title={seam.title} hideTitle tabs={tabs} shorts={null} measure
                    lead={<span className="bravais-seam-icon" />} />
            </div>
            {meta}
            {home?.account && <BravaisSeamAccountSlot account={home.account} compact={compact} onExpand={() => setLevel('full')} />}
            {seam.status && <div className="bravais-seam-vstatus" data-bravais-seam-status>{seam.status}</div>}
            {home && <BravaisSeamHomeTools home={home} compact={compact} />}
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

import React, { useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Filter, Inbox, List, Loader2, MoreHorizontal, RefreshCw, SearchX, Star, X } from 'lucide-react';
import type { BravaisSeamCollection as BravaisSeamCollectionModel, BravaisSeamFilter, BravaisSeamStatus, BravaisSeamTone } from './bravaisSeamModels';
import './bravaisCollection.css';

// src/library/suites/bravais/BravaisSeamCollection.tsx
// 完整信息条里集合层的那几块（设计稿 §10.1 放置原则、§10.2、§10.6）：
// - 过滤位：命令面板的内联过滤框画在它上面（锚点在缝里，见 BravaisSeam）；框收起但还有过滤词时显示词、匹配数与清除；
// - 标题下的收藏星标（subscribing 时转圈）；元数据行的补页进度（中断时整行是「续传」）；每日推荐的日期步进；
// - 状态行：加载中、错误（重试）、空、过滤无结果（清除过滤）——图标与文案各不相同；
// - 高频动作之外的「列表」与「⋯ 更多」（低频的集合动作，内联展开，不弹浮层）；
// - 缝底的结果提示（几秒后由 surface 撤掉，不走 toast）。

const TONE_ICONS: Record<BravaisSeamTone, React.ComponentType<{ 'aria-hidden'?: boolean; className?: string }>> = {
    loading: Loader2,
    error: AlertCircle,
    empty: Inbox,
    'no-match': SearchX,
};

/** 过滤位：高度固定，与 BravaisSeam 里过滤框锚点的位置对齐。 */
export const BravaisSeamFilterSlot: React.FC<{ filter?: BravaisSeamFilter }> = ({ filter }) => (
    <div className="bravais-seam-filter-slot" data-bravais-seam-filter={filter?.query ? 'active' : 'idle'}>
        {filter && (filter.query ? (
            <span className="bravais-seam-filter-chip">
                <button type="button" className="bravais-seam-filter-query" data-bravais-seam-action="filter" onClick={filter.onOpen}>
                    <Filter aria-hidden />
                    <span>{filter.query}</span>
                    <em>{filter.matchLabel}</em>
                </button>
                <button type="button" className="bravais-seam-icon" data-bravais-seam-action="clear-filter" onClick={filter.onClear}
                    aria-label={filter.clearLabel} title={filter.clearLabel}>
                    <X aria-hidden />
                </button>
            </span>
        ) : (
            <button type="button" className="bravais-seam-filter-open" data-bravais-seam-action="filter" onClick={filter.onOpen}>
                <Filter aria-hidden />
                <span>{filter.placeholder}</span>
            </button>
        ))}
    </div>
);

export const BravaisSeamStatusLine: React.FC<{ status: BravaisSeamStatus }> = ({ status }) => {
    const Icon = TONE_ICONS[status.tone];
    return (
        <div className={`bravais-seam-status-line is-${status.tone}`} data-bravais-seam-status={status.tone}>
            <Icon aria-hidden className={status.tone === 'loading' ? 'animate-spin' : undefined} />
            <span>{status.text}</span>
            {status.action && (
                <button type="button" className="bravais-seam-link" data-bravais-seam-action={status.action.id} onClick={status.action.run}>
                    {status.action.label}
                </button>
            )}
        </div>
    );
};

/** 标题下的星标、元数据行的补页进度、每日推荐的日期步进。 */
export const BravaisSeamCollectionMeta: React.FC<{ collection: BravaisSeamCollectionModel }> = ({ collection }) => {
    const { subscribe, sync, daily } = collection;
    return (
        <>
            {subscribe && (
                <button
                    type="button"
                    className={`bravais-seam-star${subscribe.subscribed ? ' is-on' : ''}`}
                    data-bravais-seam-action="subscribe"
                    data-bravais-subscribe={subscribe.pending ? 'pending' : subscribe.subscribed ? 'on' : 'off'}
                    aria-pressed={subscribe.subscribed}
                    disabled={subscribe.pending}
                    title={subscribe.title}
                    aria-label={subscribe.title}
                    onClick={subscribe.onToggle}
                >
                    {subscribe.pending ? <Loader2 aria-hidden className="animate-spin" /> : <Star aria-hidden />}
                </button>
            )}
            {sync && (sync.onResume ? (
                <button type="button" className="bravais-seam-sync is-interrupted" data-bravais-sync="interrupted" title={sync.title} onClick={sync.onResume}>
                    <RefreshCw aria-hidden />
                    {sync.label}
                </button>
            ) : (
                <div className="bravais-seam-sync" data-bravais-sync="syncing">
                    <RefreshCw aria-hidden className="animate-spin" />
                    {sync.label}
                </div>
            ))}
            {daily && (
                <div className="bravais-seam-daily" role="group" aria-label={daily.ariaLabel} data-bravais-daily>
                    <button type="button" className="bravais-seam-icon" data-bravais-seam-action="daily-previous" disabled={daily.disabled || !daily.onPrevious}
                        onClick={daily.onPrevious} aria-label="‹">
                        <ChevronLeft aria-hidden />
                    </button>
                    <span className="bravais-seam-daily-label" data-bravais-daily-date>{daily.label}</span>
                    <button type="button" className="bravais-seam-icon" data-bravais-seam-action="daily-next" disabled={daily.disabled || !daily.onNext}
                        onClick={daily.onNext} aria-label="›">
                        <ChevronRight aria-hidden />
                    </button>
                    {daily.onRefresh && (
                        <button type="button" className="bravais-seam-icon" data-bravais-seam-action="daily-refresh" disabled={daily.disabled}
                            onClick={daily.onRefresh} aria-label={daily.refreshLabel} title={daily.refreshLabel}>
                            <RefreshCw aria-hidden />
                        </button>
                    )}
                </div>
            )}
        </>
    );
};

/** 「列表」与「⋯ 更多」（菜单内联展开在缝里）；以及缝底的结果提示。 */
export const BravaisSeamCollectionMenu: React.FC<{ collection: BravaisSeamCollectionModel; onOpenList?: () => void }> = ({ collection, onOpenList }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <>
            <div className="bravais-seam-actions">
                {collection.listLabel && onOpenList && (
                    <button type="button" className="bravais-chrome-button" data-bravais-seam-action="list" onClick={onOpenList}>
                        <List aria-hidden />{collection.listLabel}
                    </button>
                )}
                {collection.menu.length > 0 && (
                    <button type="button" className="bravais-chrome-button" data-bravais-seam-action="more" aria-expanded={isOpen}
                        onClick={() => setIsOpen(open => !open)}>
                        <MoreHorizontal aria-hidden />{collection.moreLabel}
                    </button>
                )}
            </div>
            {isOpen && (
                <div className="bravais-seam-menu" role="menu" data-bravais-seam-menu>
                    {collection.menu.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            role="menuitem"
                            className={item.danger ? 'is-danger' : undefined}
                            disabled={item.disabled}
                            data-bravais-seam-action={item.id}
                            onClick={() => {
                                setIsOpen(false);
                                item.run();
                            }}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
            {collection.notice && (
                <div className={`bravais-seam-notice is-${collection.notice.tone}`} role="status" data-bravais-seam-notice={collection.notice.tone}>
                    {collection.notice.text}
                </div>
            )}
        </>
    );
};

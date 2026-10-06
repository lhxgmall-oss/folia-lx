import React from 'react';
import { ChevronLeft, FoldHorizontal, ListPlus, Maximize2, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer } from './bravaisLayer';
import type { BravaisSeamLevel, BravaisSeamVariant } from './bravaisSeamLevel';

// src/library/suites/bravais/BravaisSeamContent.tsx
// 缝里的四套内容（设计稿 §5）：首页窄缝（竖排「书库」+ 竖排页签）、首页书脊、完整信息条（面包屑行、竖排标题、
// 元数据、播放全部 / 加入队列）、书脊（返回、竖排标题、计数、播放、展开）。排版宽度由外层按「此刻渲染的这一套」定，
// 这里只排内容。文案都来自层描述（已翻译）与 libraryBravais 的 key。界面文案：「收起」= 收成书脊，「折叠」= 折到侧边。

export type BravaisSeamActions = {
    setLevel: (level: BravaisSeamLevel) => void;
};

type BravaisSeamContentProps = {
    variant: BravaisSeamVariant;
    layer: BravaisLayer | null;
    /** 导航栈深度：面包屑在首页与当前层之间折叠中间层。 */
    depth: number;
    actions: BravaisSeamActions;
};

/** 竖排标题的字号：按字数收，长标题不至于撑出缝。 */
const verticalTitleSize = (title: string, base: number, min: number) => (
    Math.max(min, Math.min(base, Math.round(320 / Math.max(1, [...title].length))))
);

const FoldButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
    const { t } = useTranslation();
    return (
        <button type="button" className="bravais-seam-icon" data-bravais-seam-action="hide" onClick={onClick}
            aria-label={t('libraryBravais.seamFold')} title={t('libraryBravais.seamFold')}>
            <FoldHorizontal aria-hidden />
        </button>
    );
};

const HomeSeam: React.FC<{ layer: BravaisLayer; compact: boolean; actions: BravaisSeamActions }> = ({ layer, compact, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    return (
        <div className={`bravais-seam-home${compact ? ' is-compact' : ''}`}>
            <FoldButton onClick={() => actions.setLevel('hidden')} />
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
            <div className="bravais-seam-spacer" />
            {seam.status && <div className="bravais-seam-vstatus" data-bravais-seam-status>{seam.status}</div>}
            {compact && (
                <button type="button" className="bravais-seam-icon" data-bravais-seam-action="expand" onClick={() => actions.setLevel('full')}
                    aria-label={t('libraryBravais.seamExpand')} title={t('libraryBravais.seamExpand')}>
                    <Maximize2 aria-hidden />
                </button>
            )}
        </div>
    );
};

const FullSeam: React.FC<{ layer: BravaisLayer; depth: number; actions: BravaisSeamActions }> = ({ layer, depth, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    return (
        <div className="bravais-seam-full">
            <div className="bravais-seam-crumbs">
                {layer.onDone && (
                    <button type="button" className="bravais-seam-back" data-bravais-seam-action="back" onClick={layer.onDone}
                        aria-label={t('libraryBravais.seamBack')} title={t('libraryBravais.seamBack')}>
                        <ChevronLeft aria-hidden />
                    </button>
                )}
                <span className="bravais-seam-crumb-trail">
                    <span>{t('libraryBravais.homeTitle')}</span>
                    {depth > 1 && <><i>›</i><span>…</span></>}
                    <i>›</i><span>{seam.crumb}</span>
                </span>
                <button type="button" className="bravais-seam-level" data-bravais-seam-action="spine" onClick={() => actions.setLevel('spine')}>
                    {t('libraryBravais.seamCollapse')}
                </button>
                <button type="button" className="bravais-seam-level" data-bravais-seam-action="hide" onClick={() => actions.setLevel('hidden')}>
                    {t('libraryBravais.seamFold')}
                </button>
            </div>
            <div className="bravais-seam-quote" aria-hidden>”</div>
            <div className="bravais-seam-vtitle-wrap">
                <h2 className="bravais-seam-vtitle" style={{ fontSize: verticalTitleSize(seam.title, 52, 26) }}>{seam.title}</h2>
            </div>
            <div className="bravais-seam-quote is-closing" aria-hidden>“</div>
            <div className="bravais-seam-rule" />
            <div className="bravais-seam-meta">{seam.meta}</div>
            {seam.status && <div className="bravais-seam-status" data-bravais-seam-status>{seam.status}</div>}
            <div className="bravais-seam-actions">
                {seam.onPlayScope && (
                    <button type="button" className="bravais-chrome-button is-primary" data-bravais-seam-action="play-scope" onClick={seam.onPlayScope}>
                        <Play aria-hidden />{t('libraryBravais.playAll')}
                    </button>
                )}
                {seam.onEnqueueScope && (
                    <button type="button" className="bravais-chrome-button" data-bravais-seam-action="enqueue-scope" onClick={seam.onEnqueueScope}>
                        <ListPlus aria-hidden />{t('libraryBravais.enqueueAll')}
                    </button>
                )}
            </div>
        </div>
    );
};

const SpineSeam: React.FC<{ layer: BravaisLayer; actions: BravaisSeamActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    return (
        <div className="bravais-seam-spine">
            {layer.onDone && (
                <button type="button" className="bravais-seam-icon" data-bravais-seam-action="back" onClick={layer.onDone}
                    aria-label={t('libraryBravais.seamBack')} title={t('libraryBravais.seamBack')}>
                    <ChevronLeft aria-hidden />
                </button>
            )}
            <FoldButton onClick={() => actions.setLevel('hidden')} />
            <button type="button" className="bravais-seam-vtitle is-button" data-bravais-seam-action="expand"
                style={{ fontSize: verticalTitleSize(seam.title, 30, 18) }} onClick={() => actions.setLevel('full')}
                title={t('libraryBravais.seamExpand')}>
                {seam.title}
            </button>
            <div className="bravais-seam-vcount">{seam.meta}</div>
            <div className="bravais-seam-spacer" />
            {seam.onPlayScope && (
                <button type="button" className="bravais-seam-icon" data-bravais-seam-action="play-scope" onClick={seam.onPlayScope}
                    aria-label={t('libraryBravais.playAll')} title={t('libraryBravais.playAll')}>
                    <Play aria-hidden />
                </button>
            )}
            <button type="button" className="bravais-seam-icon" data-bravais-seam-action="expand" onClick={() => actions.setLevel('full')}
                aria-label={t('libraryBravais.seamExpand')} title={t('libraryBravais.seamExpand')}>
                <Maximize2 aria-hidden />
            </button>
        </div>
    );
};

const BravaisSeamContent: React.FC<BravaisSeamContentProps> = ({ variant, layer, depth, actions }) => {
    if (!layer) return null;
    switch (variant) {
        case 'home': return <HomeSeam layer={layer} compact={false} actions={actions} />;
        case 'home-spine': return <HomeSeam layer={layer} compact actions={actions} />;
        case 'full': return <FullSeam layer={layer} depth={depth} actions={actions} />;
        case 'spine': return <SpineSeam layer={layer} actions={actions} />;
        default: return null;
    }
};

export default BravaisSeamContent;

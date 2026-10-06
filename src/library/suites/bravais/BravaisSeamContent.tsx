import React from 'react';
import { ChevronLeft, FoldHorizontal, ListPlus, Maximize2, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer } from './bravaisLayer';
import type { BravaisSeamLevel } from './bravaisSeamLevel';
import type { BravaisSeamContentVariant } from './bravaisSeamTarget';
import { BravaisSeamCollectionMenu, BravaisSeamCollectionMeta, BravaisSeamFilterSlot, BravaisSeamStatusLine } from './BravaisSeamCollection';
import BravaisListPanel, { type BravaisPanelActions } from './BravaisListPanel';
import BravaisSeamFormView from './BravaisSeamFormView';
import BravaisSeamHome from './BravaisSeamHome';
import BravaisSeamSearch from './BravaisSeamSearch';
import BravaisDirectoryPanel from './BravaisDirectoryPanel';
import BravaisSeamAccount from './BravaisSeamAccount';

// src/library/suites/bravais/BravaisSeamContent.tsx
// 缝里的四套内容（设计稿 §5）：首页窄缝（竖排「书库」+ 竖排页签）、首页书脊、完整信息条（面包屑行、竖排标题、
// 元数据、播放全部 / 加入队列）、书脊（返回、竖排标题、计数、播放、展开）。排版宽度由外层按「此刻渲染的这一套」定，
// 这里只排内容。文案都来自层描述（已翻译）与 libraryBravais 的 key。界面文案：「收起」= 收成书脊，「折叠」= 折到侧边。
// B9：首页窄缝 / 书脊换成 BravaisSeamHome（页签、二级切换、工具按钮、管理隐藏、账户位），另有全局搜索框（search）；
// 首页层的面板是目录树（BravaisDirectoryPanel），集合层的面板仍是歌曲列表。
// B10：账户的登录态 / 确认态（login / confirm）不属于任何一层，内容来自 bravaisAccountStore（BravaisSeamAccount）。

export type BravaisSeamActions = {
    setLevel: (level: BravaisSeamLevel) => void;
    /** B7：打开列表面板、面板里的定位 / 播放 / 关闭（stage 给）。 */
    openList?: () => void;
    panel?: BravaisPanelActions;
};

type BravaisSeamContentProps = {
    variant: BravaisSeamContentVariant;
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

const FullSeam: React.FC<{ layer: BravaisLayer; depth: number; actions: BravaisSeamActions }> = ({ layer, depth, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const collection = seam.collection;
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
            {collection && <BravaisSeamFilterSlot filter={collection.filter} />}
            <div className="bravais-seam-quote" aria-hidden>”</div>
            <div className="bravais-seam-vtitle-wrap">
                <h2 className="bravais-seam-vtitle" data-bravais-seam-title style={{ fontSize: verticalTitleSize(seam.title, 52, 26) }}>{seam.title}</h2>
            </div>
            <div className="bravais-seam-quote is-closing" aria-hidden>“</div>
            <div className="bravais-seam-rule" />
            <div className="bravais-seam-meta">{seam.meta}</div>
            {collection && <BravaisSeamCollectionMeta collection={collection} />}
            {seam.status && <div className="bravais-seam-status" data-bravais-seam-status>{seam.status}</div>}
            {collection?.status && <BravaisSeamStatusLine status={collection.status} />}
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
            {collection && <BravaisSeamCollectionMenu collection={collection} onOpenList={actions.openList} />}
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
            <button type="button" className="bravais-seam-vtitle is-button" data-bravais-seam-action="expand" data-bravais-seam-title
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
        case 'home': return <BravaisSeamHome layer={layer} compact={false} setLevel={actions.setLevel} />;
        case 'home-spine': return <BravaisSeamHome layer={layer} compact setLevel={actions.setLevel} />;
        case 'search': return <BravaisSeamSearch layer={layer} />;
        case 'full': return <FullSeam layer={layer} depth={depth} actions={actions} />;
        case 'spine': return <SpineSeam layer={layer} actions={actions} />;
        case 'panel':
            if (!actions.panel) return null;
            return layer.home?.panel
                ? <BravaisDirectoryPanel layer={layer} actions={actions.panel} />
                : <BravaisListPanel layer={layer} depth={depth} actions={actions.panel} />;
        case 'form': return layer.seam.collection?.form ? <BravaisSeamFormView form={layer.seam.collection.form} /> : null;
        case 'login':
        case 'confirm': return <BravaisSeamAccount variant={variant} />;
        default: return null;
    }
};

export default BravaisSeamContent;

import React, { useMemo } from 'react';
import { ChevronLeft, ListFilter, ListPlus, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import type { BravaisLayer } from './bravaisLayer';
import type { BravaisSeamActions } from './BravaisSeamContent';
import { BravaisSeamCollectionMenu, BravaisSeamCollectionMeta, BravaisSeamStar, BravaisSeamStatusLine } from './BravaisSeamCollection';
import BravaisSeamAbout from './BravaisSeamAbout';
import { BravaisSeamFlipText } from './BravaisSeamFlip';
import BravaisSeamCrumbs from './BravaisSeamCrumbs';
import { openBravaisFilter } from './useBravaisSeamFilter';
import { resolveAlbumComposition } from './bravaisPosterComposition';
import { splitHeroWord } from './BravaisSeamPoster';
import './bravaisPoster.css';
import './bravaisAlbumPoster.css';

// src/library/suites/bravais/BravaisSeamAlbumPoster.tsx
// 专辑页的海报（完整等级下的专辑页缝，见 bravaisSeamTarget 的 'poster'）：凝彩的视觉语言，参考稿 album.png 竖过来——
// 上半是浅色点阵纸，封面斜着贴在上面（一条胶带、墨色硬阴影），旁边竖排一行碎字；一道斜线网纹把纸和下半的深色块切开；
// 色块上是「专辑 · 年份」的小标签、奶油色带立体残影的大标题（标题里一个词放大错开）、强调色下划线、「歌手 · 首数 · 时长 ·
// 流派」、一句简介，最下面是播放全部 / 加入队列 / 收藏 / 「⋯ 更多」。色块上还有一个描边的水印大字。
// 构图按专辑定死（bravaisPosterComposition 的 resolveAlbumComposition），颜色从封面取（bravaisPosterPalette 的专辑那套，
// 变量写在 stage 根节点上）。缝里原有的功能都在：返回与面包屑、过滤当前页、补页进度、状态行与重试、结果提示。
// 纸、色块、网纹、水印这些底子不缩；倾斜时文字、封面与按钮（bravais-poster-ui）缩进安全区。

const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const TITLE_LINES = 3;

/** 一段字占几格：中日韩文字一个字一格，其余按 0.62 格估。 */
const columnsOf = (text: string) => [...text].reduce((sum, character) => sum + (WIDE.test(character) ? 1.02 : 0.62), 0);

/** 标题字号按一行要放几格收：标题最多折成 TITLE_LINES 行，最长的那个词不能被折开。 */
const titleColumns = (title: string) => {
    const longestWord = Math.max(0, ...title.split(/\s+/).filter(word => !WIDE.test(word)).map(columnsOf));
    return Math.max(2, longestWord, columnsOf(title) / TITLE_LINES);
};

const COVER_PX = 512;

const BravaisSeamAlbumPoster: React.FC<{ layer: BravaisLayer; actions: BravaisSeamActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const album = seam.album;
    const collection = seam.collection;
    const title = seam.title;
    const words = useMemo(() => splitHeroWord(title), [title]);
    const hero = words.find(word => word.hero)?.text;
    const ghost = [...(hero ?? title)].slice(-1).join('');
    const composition = useMemo(() => resolveAlbumComposition(layer.key), [layer.key]);
    const fold = useMemo(() => ({ label: t('libraryBravais.seamFoldStrip'), run: () => actions.setLevel('hidden') }), [actions, t]);
    const coverUrl = album?.coverUrl ? getSizedCoverUrl(album.coverUrl, COVER_PX) : undefined;
    const style = {
        '--bravais-album-title-columns': titleColumns(title),
        '--bravais-album-divider-left': `${composition.divider.left}%`,
        '--bravais-album-divider-right': `${composition.divider.right}%`,
        '--bravais-album-cover-deg': `${composition.coverDeg}deg`,
        '--bravais-album-tape-x': `${composition.tape.x}%`,
        '--bravais-album-tape-deg': `${composition.tape.deg}deg`,
        '--bravais-album-underline': `${composition.underline}%`,
        '--bravais-album-hero-x': `${composition.hero.x}em`,
        '--bravais-album-hero-y': `${composition.hero.y}em`,
        '--bravais-album-hero-deg': `${composition.hero.deg}deg`,
    } as React.CSSProperties;
    const year = album?.kicker;
    return (
        <section className="bravais-poster bravais-album-poster" style={style} aria-label={t('libraryBravaisAlbum.posterLabel')}
            data-bravais-poster data-bravais-album-poster>
            <div className="bravais-poster-ground" aria-hidden>
                <div className="bravais-album-paper" />
                <div className="bravais-album-hatch" />
                <div className="bravais-album-dots" />
                <div className="bravais-album-ghost" data-side={composition.ghostSide}>{ghost}</div>
                <div className="bravais-poster-grain" />
            </div>

            <div className="bravais-poster-ui">
                <div className="bravais-poster-top">
                    <div className="bravais-seam-crumbs">
                        {layer.onDone && (
                            <button type="button" className="bravais-seam-back" data-bravais-seam-action="back" onClick={layer.onDone}
                                aria-label={t('libraryBravais.seamBack')} title={t('libraryBravais.seamBack')}>
                                <ChevronLeft aria-hidden />
                            </button>
                        )}
                        <BravaisSeamCrumbs layer={layer} />
                    </div>
                    {seam.filter && (
                        <button type="button" className="bravais-poster-filter" data-bravais-seam-action="filter" onClick={openBravaisFilter}
                            title={seam.filter.placeholder}>
                            <ListFilter aria-hidden />{seam.filter.placeholder}
                        </button>
                    )}
                </div>

                <div className="bravais-album-stage">
                    <figure className="bravais-album-cover" data-bravais-album-cover>
                        {coverUrl ? <img src={coverUrl} alt="" draggable={false} /> : <span className="bravais-album-cover-empty" />}
                        <span className="bravais-album-tape" aria-hidden />
                    </figure>
                    <div className="bravais-album-scrap" aria-hidden>
                        {title}{year ? ` · ${year}` : ''}
                    </div>
                </div>

                <div className="bravais-album-title-block">
                    {album?.kicker && <span className="bravais-album-kicker">{album.kicker}</span>}
                    <h2 className="bravais-album-title" data-bravais-seam-title data-bravais-album-title>
                        {words.map((word, index) => (
                            <span key={index} className={word.hero ? 'is-hero' : undefined} data-text={word.text}>{word.text}</span>
                        ))}
                    </h2>
                    <div className="bravais-album-underline" aria-hidden />
                </div>

                <div className="bravais-poster-bottom bravais-album-bottom">
                    <div className="bravais-album-facts" data-bravais-album-facts>
                        {album && album.artists.length > 0 && <span className="bravais-album-artist">{album.artists.join(' / ')}</span>}
                        {seam.meta && <BravaisSeamFlipText as="span" flipKey={seam.meta} className="bravais-poster-meta">{seam.meta}</BravaisSeamFlipText>}
                        {album?.facts.filter(fact => fact !== seam.meta).map(fact => <span key={fact} className="bravais-album-fact">{fact}</span>)}
                    </div>
                    {collection?.description && (
                        <BravaisSeamAbout data-bravais-seam-about="collection" text={collection.description} textAttribute="data-bravais-collection-description" />
                    )}
                    {collection && <BravaisSeamCollectionMeta collection={collection} />}
                    {seam.status && <BravaisSeamFlipText as="div" flipKey={seam.status} className="bravais-seam-status" data-bravais-seam-status>{seam.status}</BravaisSeamFlipText>}
                    {collection?.status && <BravaisSeamStatusLine status={collection.status} />}
                    <div className="bravais-poster-actions">
                        {seam.onPlayScope && (
                            <button type="button" className="bravais-poster-button is-primary" data-bravais-seam-action="play-scope" onClick={seam.onPlayScope}>
                                <Play aria-hidden />{seam.scopeLabels?.play ?? t('libraryBravais.playAll')}
                            </button>
                        )}
                        {seam.onEnqueueScope && (
                            <button type="button" className="bravais-poster-button" data-bravais-seam-action="enqueue-scope" onClick={seam.onEnqueueScope}>
                                <ListPlus aria-hidden />{seam.scopeLabels?.enqueue ?? t('libraryBravais.enqueueAll')}
                            </button>
                        )}
                        {collection?.subscribe && <BravaisSeamStar subscribe={collection.subscribe} />}
                        <BravaisSeamCollectionMenu collection={collection} onOpenList={actions.openList} fold={fold} />
                    </div>
                </div>
            </div>
        </section>
    );
};

export default BravaisSeamAlbumPoster;

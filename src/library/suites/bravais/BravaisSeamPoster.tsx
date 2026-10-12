import React, { useCallback, useMemo } from 'react';
import { ChevronLeft, ListFilter, ListPlus, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import type { BravaisItem, BravaisLayer } from './bravaisLayer';
import type { BravaisSeamActions } from './BravaisSeamContent';
import { BravaisSeamCollectionMenu, BravaisSeamCollectionMeta, BravaisSeamStatusLine } from './BravaisSeamCollection';
import BravaisSeamAbout from './BravaisSeamAbout';
import { BravaisSeamFlipText } from './BravaisSeamFlip';
import BravaisSeamCrumbs from './BravaisSeamCrumbs';
import { openBravaisFilter } from './useBravaisSeamFilter';
import './bravaisPoster.css';

// src/library/suites/bravais/BravaisSeamPoster.tsx
// 歌手页的海报（完整等级下的歌手页缝，钉在视口左边，见 bravaisSeamTarget 的 'poster' 与 bravaisFrame 的 pinned）：
// 用商籁（Sonnet）的视觉语言——炭灰单色底，定妆照去色压暗、盖一层网点，像商籁的烟雾背景；发丝线画框（角标、竖线、
// 十字、小菱形）与参考线，竖排的等宽 HUD 标签，背景里描边的巨字；歌手名是发光的白字（带一点红青色差），套在虚线的
// 选中框里（四角朝外的箭头）；热门歌曲前三首（每首的标题里最长的那个词放大发光）。
// 缝里原有的功能都还在：返回与面包屑、过滤专辑（点了缝临时展开成完整信息条，与书脊上的过滤图标同一条路）、
// 播放热门 / 加入队列、「⋯ 更多」（列表面板、折叠、本地歌手的编辑），以及「关于艺术家」（简介两行截断、统计附注）、
// 专辑补页进度、加载失败与重试这些状态行（与完整信息条同一套组件）。
// 底色是海报自己的（不跟缝的材质预设、透明缝、叠色与熄灯走）；画框与参考线都是静态的，没有逐帧动画。

const TOP_SONG_COUNT = 3;

/** 名字的字号按字数收：中日韩文字一个字一格，其余按 0.62 格估。 */
const nameColumns = (name: string) => {
    const characters = [...name];
    const wide = characters.filter(character => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)).length;
    return Math.max(2, wide * 1.02 + (characters.length - wide) * 0.62);
};

let wordSegmenter: Intl.Segmenter | null = null;

/** 歌名拆成词，最长的那个词（按字素数，只看文字词）放大，其余原样。 */
export const splitHeroWord = (title: string): { text: string; hero: boolean }[] => {
    wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
    const parts = Array.from(wordSegmenter.segment(title), part => ({ text: part.segment, wordLike: Boolean(part.isWordLike) }));
    let heroIndex = -1;
    let heroLength = 0;
    parts.forEach((part, index) => {
        const length = [...part.text].length;
        if (part.wordLike && length > heroLength) {
            heroIndex = index;
            heroLength = length;
        }
    });
    // 整个标题就是一个词：不放大（没有对比就没有重心）。
    if (parts.filter(part => part.wordLike).length < 2) heroIndex = -1;
    return parts.map((part, index) => ({ text: part.text, hero: index === heroIndex }));
};

const PosterSong: React.FC<{ item: BravaisItem; index: number; onPlay?: (key: string) => void }> = ({ item, index, onPlay }) => {
    const words = useMemo(() => splitHeroWord(item.title), [item.title]);
    const play = useCallback(() => onPlay?.(item.key), [item.key, onPlay]);
    return (
        <li>
            <button type="button" className="bravais-poster-song" onClick={play} disabled={!onPlay || item.unavailable}
                data-bravais-poster-song={item.key} aria-label={item.subtitle ? `${item.title} · ${item.subtitle}` : item.title}>
                <span className="bravais-poster-song-index" aria-hidden>{String(index + 1).padStart(2, '0')}</span>
                <span className="bravais-poster-song-title" aria-hidden>
                    {words.map((word, wordIndex) => (
                        <span key={wordIndex} className={word.hero ? 'is-hero' : undefined}>{word.text}</span>
                    ))}
                </span>
            </button>
        </li>
    );
};

/** 竖排 HUD 标签里的名字：大写、空白换成连字符（商籁画框上的「[ THEME ] MIDNIGHT-DEFAULT」那一种）。 */
const hudName = (name: string) => name.trim().toUpperCase().replace(/\s+/g, '-');

const BravaisSeamPoster: React.FC<{ layer: BravaisLayer; actions: BravaisSeamActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const artist = seam.artist;
    const name = seam.title;
    const coverUrl = artist?.coverUrl;
    const topSongs = useMemo(
        () => layer.items.filter(item => item.kind === 'track').slice(0, TOP_SONG_COUNT),
        [layer.items],
    );
    const fold = useMemo(() => ({ label: t('libraryBravais.seamFoldStrip'), run: () => actions.setLevel('hidden') }), [actions, t]);
    const style = { '--bravais-poster-name-columns': nameColumns(name) } as React.CSSProperties;
    return (
        <section className="bravais-poster" style={style} aria-label={t('libraryBravaisArtist.posterLabel')} data-bravais-poster>
            <div className="bravais-poster-ground" aria-hidden>
                {coverUrl && (
                    <div className="bravais-poster-portrait" data-bravais-poster-portrait>
                        <img src={getSizedCoverUrl(coverUrl, 1024)} alt="" draggable={false} decoding="async" />
                    </div>
                )}
                <div className="bravais-poster-smoke" />
                <div className="bravais-poster-giant">{name}</div>
                <div className="bravais-poster-guides">
                    <i className="is-v1" /><i className="is-v2" /><i className="is-h1" /><i className="is-h2" />
                    <b className="is-d1" /><b className="is-d2" /><b className="is-d3" />
                </div>
                <div className="bravais-poster-frame">
                    <i className="is-tl-bar" /><i className="is-tl-line" /><i className="is-tr-cross" />
                    <i className="is-br-line" /><i className="is-br-bar" /><i className="is-br-rule" /><b className="is-br-diamond" /><b className="is-bl-diamond" />
                </div>
                <div className="bravais-poster-hud">[ ARTIST ] {hudName(name)}</div>
                <div className="bravais-poster-orbit"><i /><b /></div>
            </div>

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

            <div className="bravais-poster-title">
                <div className="bravais-poster-kicker">{t('libraryBravais.kind.artist')}<span aria-hidden> · ARTIST</span></div>
                {/* 商籁的选中框：虚线框、四角朝外的箭头，名字发光（带一点红青色差）。 */}
                <div className="bravais-poster-select">
                    <i className="is-tl" aria-hidden /><i className="is-tr" aria-hidden /><i className="is-bl" aria-hidden /><i className="is-br" aria-hidden />
                    <h2 className="bravais-poster-name" data-bravais-poster-name data-bravais-seam-title>{name}</h2>
                </div>
            </div>

            <div className="bravais-poster-bottom">
                {/* 统计已是「关于艺术家」的附注：相同时元数据行不重复（过滤中是匹配数，照常显示）。 */}
                {seam.meta && !(artist?.stats && artist.stats === seam.meta) && (
                    <BravaisSeamFlipText as="div" flipKey={seam.meta} className="bravais-poster-meta">{seam.meta}</BravaisSeamFlipText>
                )}
                {artist && (artist.description || artist.stats) && (
                    <BravaisSeamAbout data-bravais-seam-artist text={artist.description} textAttribute="data-bravais-artist-bio"
                        note={artist.stats} noteAttribute="data-bravais-artist-stats" />
                )}
                {seam.collection && <BravaisSeamCollectionMeta collection={seam.collection} />}
                {seam.status && <BravaisSeamFlipText as="div" flipKey={seam.status} className="bravais-seam-status" data-bravais-seam-status>{seam.status}</BravaisSeamFlipText>}
                {seam.collection?.status && <BravaisSeamStatusLine status={seam.collection.status} />}
                {topSongs.length > 0 && (
                    <ol className="bravais-poster-songs" aria-label={t('libraryBravaisArtist.posterTopSongs')}>
                        {topSongs.map((item, index) => <PosterSong key={item.key} item={item} index={index} onPlay={layer.onPlayItem} />)}
                    </ol>
                )}
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
                    <BravaisSeamCollectionMenu collection={seam.collection} onOpenList={actions.openList} fold={fold} />
                </div>
            </div>
        </section>
    );
};

export default BravaisSeamPoster;

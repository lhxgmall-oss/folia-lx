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
import { useBravaisArtistTone } from './bravaisArtistTone';
import './bravaisPoster.css';

// src/library/suites/bravais/BravaisSeamPoster.tsx
// 歌手页的海报（完整等级下的歌手页缝，钉在视口左边，见 bravaisSeamTarget 的 'poster' 与 bravaisFrame 的 pinned）：
// 凝彩（Tempera）的版式语汇搬到缝里——定妆照垫底（去色、按头像取色染成双色调、盖一层网点），一块斜切的纸色色块，
// 歌手名超大、放在反色层上（跨过色块的那一半自动翻色），描边水印，热门歌曲前三首（每首的标题里最长的那个词放大）。
// 缝里原有的功能都还在：返回与面包屑、过滤专辑（点了缝临时展开成完整信息条，与书脊上的过滤图标同一条路）、
// 播放热门 / 加入队列、「⋯ 更多」（列表面板、折叠、本地歌手的编辑），以及「关于艺术家」（简介两行截断、统计附注）、
// 专辑补页进度、加载失败与重试这些状态行（与完整信息条同一套组件）。
// 底色、纸色、墨色是海报自己的（不跟缝的材质预设、透明缝、叠色与熄灯走）：反色层只有在已知的不透明底上才可读。
// 混合层（反色标题、染色人像、网点）都是静态的，没有逐帧变化。

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

const BravaisSeamPoster: React.FC<{ layer: BravaisLayer; actions: BravaisSeamActions }> = ({ layer, actions }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const artist = seam.artist;
    const name = seam.title;
    const coverUrl = artist?.coverUrl;
    // 双色调的亮端取自头像（与墙上的歌手磁贴同一份取色与缓存）；取不到就用主题强调色。
    const tone = useBravaisArtistTone(coverUrl, Boolean(coverUrl));
    const topSongs = useMemo(
        () => layer.items.filter(item => item.kind === 'track').slice(0, TOP_SONG_COUNT),
        [layer.items],
    );
    const fold = useMemo(() => ({ label: t('libraryBravais.seamFoldStrip'), run: () => actions.setLevel('hidden') }), [actions, t]);
    const style = {
        '--bravais-poster-name-columns': nameColumns(name),
        ...(typeof tone === 'string' ? { '--bravais-poster-tone': tone } : null),
    } as React.CSSProperties;
    return (
        <section className="bravais-poster" style={style} aria-label={t('libraryBravaisArtist.posterLabel')} data-bravais-poster>
            <div className="bravais-poster-ground" aria-hidden>
                {coverUrl && tone !== false && (
                    <div className="bravais-poster-portrait" data-bravais-poster-portrait>
                        <img src={getSizedCoverUrl(coverUrl, 1024)} alt="" draggable={false} decoding="async" />
                    </div>
                )}
                <div className="bravais-poster-block" />
                <div className="bravais-poster-block-print" />
                <div className="bravais-poster-hatch" />
                <div className="bravais-poster-watermark">{name}</div>
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

            <div className="bravais-poster-tag">{t('libraryBravais.kind.artist')}</div>
            {/* 名字的残影在反色层之下（不翻色），名字本身在反色层上。 */}
            <div className="bravais-poster-echo" aria-hidden>{name}</div>
            <h2 className="bravais-poster-name" data-bravais-poster-name data-bravais-seam-title>{name}</h2>

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

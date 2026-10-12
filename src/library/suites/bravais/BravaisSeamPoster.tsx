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
import { posterShapeClipPath, resolvePosterComposition } from './bravaisPosterComposition';
import './bravaisPoster.css';

// src/library/suites/bravais/BravaisSeamPoster.tsx
// 歌手页的海报（完整等级下的歌手页缝，钉在视口左边，见 bravaisSeamTarget 的 'poster' 与 bravaisFrame 的 pinned）：
// 用凝彩（Tempera）的视觉语言，构图按歌手定死、每个歌手一幅（bravaisPosterComposition）——灰色的胶片颗粒纸底、四周压暗；定妆照去色、套在一块大的斜切色块里（白色发丝描边 + 错开的
// 虚影，块里盖网点），像凝彩里装着画面的几何形；斜穿整幅的贯穿线、四角的取景角标、斜线填充的小方块、「· · ·」，散落的
// 灰色碎字（取自热门歌名里放大的那个词）；歌手名是超粗的黑体、白到灰的渐变，后面拖着错开的立体残影，旁边一个小词
// （「歌手」）与它错落排在一起；热门歌曲前三首（每首的标题里最长的那个词放大、带同样的残影）。
// 缝里原有的功能都还在：返回与面包屑、过滤专辑（点了缝临时展开成完整信息条，与书脊上的过滤图标同一条路）、
// 播放热门 / 加入队列、「⋯ 更多」（列表面板、折叠、本地歌手的编辑），以及「关于艺术家」（简介两行截断、统计附注）、
// 专辑补页进度、加载失败与重试这些状态行（与完整信息条同一套组件）。
// 底色是海报自己的（不跟缝的材质预设、透明缝、叠色与熄灯走）；画面全是静态的，没有逐帧动画。

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

/** 碎字：热门歌名里放大的那个词（没有就取整个歌名的前两个字），最多三个，散在海报上。 */
const scrapWords = (items: readonly BravaisItem[]) => items.map(item => {
    const hero = splitHeroWord(item.title).find(part => part.hero)?.text;
    return hero ?? [...item.title.trim()].slice(0, 2).join('');
}).filter(Boolean).slice(0, 3);

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
    const scraps = useMemo(() => scrapWords(topSongs), [topSongs]);
    // 构图按层的 key（含歌手 id）定死：同一个歌手每次都是同一幅（bravaisPosterComposition）。
    const composition = useMemo(() => resolvePosterComposition(layer.key), [layer.key]);
    const clipPath = posterShapeClipPath(composition.shape);
    const fold = useMemo(() => ({ label: t('libraryBravais.seamFoldStrip'), run: () => actions.setLevel('hidden') }), [actions, t]);
    const style = { '--bravais-poster-name-columns': nameColumns(name) } as React.CSSProperties;
    return (
        <section className="bravais-poster" style={style} aria-label={t('libraryBravaisArtist.posterLabel')} data-bravais-poster>
            <div className="bravais-poster-ground" aria-hidden>
                {/* 装着定妆照的斜切色块：先画错开的虚影，再画块本身（照片 + 网点 + 白色描边）。 */}
                <div className="bravais-poster-shape-ghost" style={{ clipPath, transform: `translate(${composition.ghost.x}px, ${composition.ghost.y}px)` }} />
                <div className="bravais-poster-shape" style={{ clipPath }}>
                    {coverUrl && (
                        <div className="bravais-poster-portrait" data-bravais-poster-portrait>
                            <img src={getSizedCoverUrl(coverUrl, 1024)} alt="" draggable={false} decoding="async" />
                        </div>
                    )}
                </div>
                {composition.shape.kind === 'polygon' ? (
                    <svg className="bravais-poster-shape-edge" viewBox="0 0 100 100" preserveAspectRatio="none">
                        <polygon points={composition.shape.points.map(([x, y]) => `${x},${y}`).join(' ')} />
                    </svg>
                ) : (
                    <div className="bravais-poster-shape-ring" style={{ left: `${composition.shape.cx}%`, top: `${composition.shape.cy}%` }} />
                )}
                <div className="bravais-poster-grain" />
                {composition.through.map((line, index) => (
                    <i key={index} className={`bravais-poster-through is-${index}`} style={{ top: `${line.y}%`, transform: `rotate(${line.deg}deg)` }} />
                ))}
                <div className="bravais-poster-corners"><i className="is-tl" /><i className="is-tr" /><i className="is-bl" /><i className="is-br" /></div>
                <div className="bravais-poster-finder"><i className="is-l" /><i className="is-r" /></div>
                <div className="bravais-poster-hatch" data-side={composition.hatch.side} style={{ top: `${composition.hatch.y}%` }}><i /><i /></div>
                <div className="bravais-poster-dots" style={{ left: `${composition.dots.x}%`, top: `${composition.dots.y}%` }}>· · ·</div>
                {scraps.map((word, index) => {
                    const scrap = composition.scraps[index];
                    return (
                        <span key={index} className="bravais-poster-scrap" style={{
                            left: `${scrap.x}%`,
                            top: `${scrap.y}%`,
                            fontSize: `min(${Math.round(scrap.size * 8.75)}px, ${scrap.size.toFixed(2)}cqh)`,
                            transform: `rotate(${scrap.deg.toFixed(1)}deg)`,
                            opacity: scrap.opacity,
                        }}>{word}</span>
                    );
                })}
            </div>

            {/* 文字与按钮：倾斜时整块缩进安全区（四个角不转出屏幕）；上面的色块、颗粒与细线不缩，转出去也无妨。 */}
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

                <div className="bravais-poster-title">
                    {/* 小词与大字错落排在一起（凝彩一行里一个放大的 hero 词、其余压小）。 */}
                    <span className="bravais-poster-kicker" aria-hidden>{t('libraryBravais.kind.artist')}</span>
                    <h2 className="bravais-poster-name" data-bravais-poster-name data-bravais-seam-title data-text={name}>{name}</h2>
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
            </div>
        </section>
    );
};

export default BravaisSeamPoster;

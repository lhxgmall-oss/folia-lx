import React, { type MouseEvent } from 'react';
import { Check, Play, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WallTitle } from '../../../components/wall/WallTitle';
import type { BravaisItem } from './bravaisLayer';

// src/library/suites/bravais/BravaisFocusCardBody.tsx
// 聚焦卡（6×6 就地展开的歌曲卡，设计稿 §7「聚焦卡」）的文字区：大标题，可点的歌手 / 专辑链接与时长，底部两个按钮
// 「立即播放」「加入队列」（已在队列时是「✓ 已在队列」）。立即播放之后去哪由 folia 的「播放进入视图」决定
// （宿主的播放端口），这里不另做原地播放。链接能不能点由 surface 判定（core 的 trackLinks 规则）。

export type BravaisFocusCardActions = {
    play: (slotKey: string) => void;
    enqueue: (slotKey: string) => void;
    canOpenAlbum: (itemKey: string) => boolean;
    openAlbum: (slotKey: string) => void;
    canOpenArtist: (itemKey: string, index: number) => boolean;
    openArtist: (slotKey: string, index: number) => void;
};

type BravaisFocusCardBodyProps = {
    slotKey: string;
    item: BravaisItem;
    queued: boolean;
    titleWidth: number;
    actions: BravaisFocusCardActions;
};

/** 按钮上的点击不冒泡到磁贴（磁贴的点击是「展开 / 打开」）。 */
const handled = (run: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    run();
};

const BravaisFocusCardBody: React.FC<BravaisFocusCardBodyProps> = ({ slotKey, item, queued, titleWidth, actions }) => {
    const { t } = useTranslation();
    const artists = item.artists ?? [];
    const canOpenAlbum = Boolean(item.album) && actions.canOpenAlbum(item.key);
    return (
        <span className="lattice-poster-copy bravais-focus-copy" data-bravais-focus-card={item.key}>
            <WallTitle title={item.title} expanded targetPosterWidth={titleWidth} />
            <span className="bravais-focus-links">
                {artists.map((name, index) => (
                    <React.Fragment key={`${index}:${name}`}>
                        {index > 0 && <i>,</i>}
                        {actions.canOpenArtist(item.key, index) ? (
                            <button type="button" data-bravais-action="open-artist" onClick={handled(() => actions.openArtist(slotKey, index))}>
                                {name}
                            </button>
                        ) : <span>{name}</span>}
                    </React.Fragment>
                ))}
                {item.album && (
                    <>
                        {artists.length > 0 && <i>·</i>}
                        {canOpenAlbum ? (
                            <button type="button" data-bravais-action="open-album" onClick={handled(() => actions.openAlbum(slotKey))}>
                                {item.album}
                            </button>
                        ) : <span>{item.album}</span>}
                    </>
                )}
                {item.durationLabel && (
                    <>
                        <i>·</i>
                        <span className="tabular-nums">{item.durationLabel}</span>
                    </>
                )}
            </span>
            <span className="bravais-focus-actions">
                <button
                    type="button"
                    className="bravais-chrome-button is-primary"
                    data-bravais-action="play"
                    disabled={item.unavailable}
                    onClick={handled(() => actions.play(slotKey))}
                >
                    <Play aria-hidden />
                    {t('libraryBravais.playNow')}
                </button>
                <button
                    type="button"
                    className="bravais-chrome-button"
                    data-bravais-action="enqueue"
                    data-bravais-queued={queued || undefined}
                    disabled={item.unavailable}
                    onClick={handled(() => actions.enqueue(slotKey))}
                >
                    {queued ? <Check aria-hidden /> : <Plus aria-hidden />}
                    {queued ? t('libraryBravais.inQueue') : t('libraryBravais.addToQueue')}
                </button>
            </span>
        </span>
    );
};

export default BravaisFocusCardBody;

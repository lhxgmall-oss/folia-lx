import React, { useState } from 'react';
import { Disc } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import type { BravaisSeamArtist as BravaisSeamArtistModel } from './bravaisSeamModels';
import './bravaisArtist.css';

// src/library/suites/bravais/BravaisSeamArtist.tsx
// 完整信息条里歌手页的信息块（设计稿 §10.4「缝承载 ArtistGridView 的信息」）：圆形头像、别名、统计与简介。
// 简介默认收成几行，点一下展开 / 收起（只在缝里，不弹浮层）。文案都由 surface 翻译好。

const AVATAR_PX = 56;

const BravaisSeamArtist: React.FC<{ artist: BravaisSeamArtistModel }> = ({ artist }) => {
    const { t } = useTranslation();
    const [isBioOpen, setIsBioOpen] = useState(false);
    return (
        <div className="bravais-seam-artist" data-bravais-seam-artist>
            <div className="bravais-seam-artist-head">
                <span className="bravais-seam-artist-avatar" style={{ width: AVATAR_PX, height: AVATAR_PX }}>
                    {artist.coverUrl ? (
                        <img src={getSizedCoverUrl(artist.coverUrl, 128)} alt={artist.name} draggable={false} decoding="async" />
                    ) : (
                        <Disc aria-hidden />
                    )}
                </span>
                <span className="bravais-seam-artist-facts">
                    {artist.aliases && <span className="bravais-seam-artist-aliases" data-bravais-artist-aliases>{artist.aliases}</span>}
                    {artist.stats && <span className="bravais-seam-artist-stats" data-bravais-artist-stats>{artist.stats}</span>}
                </span>
            </div>
            {artist.description && (
                <button
                    type="button"
                    className={`bravais-seam-artist-bio${isBioOpen ? ' is-open' : ''}`}
                    data-bravais-artist-bio={isBioOpen ? 'expanded' : 'collapsed'}
                    aria-expanded={isBioOpen}
                    title={isBioOpen ? t('libraryTui.bioLess') : t('libraryTui.bioMore')}
                    onClick={() => setIsBioOpen(open => !open)}
                >
                    {artist.description}
                </button>
            )}
        </div>
    );
};

export default BravaisSeamArtist;

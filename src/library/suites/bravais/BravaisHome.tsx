import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryHomeSurfaceProps } from '../../core/contracts/suite';
import type { LibraryHomeCard, LibraryHomeTabKey } from '../../core/contracts/homeModel';
import { useLibraryHomeSources } from '../../core/bindings/useLibraryHomeSources';
import { useLibraryHomeOnline } from '../../core/bindings/useLibraryHomeOnline';
import { useLibraryHomeTabsRegistration } from '../../core/bindings/useLibraryHomeSurfaceRegistration';
import type { BravaisItemKind, BravaisLayer, BravaisSeamModel } from './bravaisLayer';
import { homeCardItemKey, projectHomeCards } from './bravaisProjection';
import { useBravaisLayerRegistration } from './useBravaisLayerRegistration';

// src/library/suites/bravais/BravaisHome.tsx
// 首页 surface（B6：只有「歌单」页签铺墙）。与 TUI、网格用同一套首页绑定（来源与页签、在线列表都来自 core，
// 换 suite 不重新请求），把当前页签的卡片投影成层描述推进 stage store；它自己只渲染一个不可见的锚点。
// 其它页签（专辑、电台、本地、Navidrome）在 B9 铺墙：现在缝里照常列出页签，选中它们时墙面留空、缝里说明还没有墙面。
// 打开卡片经首页资源的 openOnlineCard（与 TUI 同一个入口），被点的磁贴由 stage 记成新层的起点。

const NO_KEYS: ReadonlySet<string> = new Set();
const NO_CARDS: LibraryHomeCard[] = [];

const KIND_LABEL_KEYS: Record<BravaisItemKind, string> = {
    track: 'libraryBravais.kind.track',
    playlist: 'libraryBravais.kind.playlist',
    album: 'libraryBravais.kind.album',
    artist: 'libraryBravais.kind.artist',
    folder: 'libraryBravais.kind.folder',
    feed: 'libraryBravais.kind.feed',
};

const BravaisHome: React.FC<LibraryHomeSurfaceProps> = ({
    account,
    user,
    playlists,
    cloudPlaylist,
    navidromeEnabled,
    homeResources,
    onOpenGridView,
    isInteractive,
}) => {
    const { t } = useTranslation();
    const sources = useLibraryHomeSources({ account, user, playlists, cloudPlaylist, navidromeEnabled });
    const { tab, setTab, tabs, online } = sources;
    const onlineList = useLibraryHomeOnline(homeResources, sources);

    const selectTab = useCallback((key: LibraryHomeTabKey) => {
        const target = tabs.find(candidate => candidate.key === key);
        if (!target || target.disabledReason) return false;
        setTab(key);
        return true;
    }, [setTab, tabs]);
    useLibraryHomeTabsRegistration({ getState: () => ({ active: tab, tabs }), setTab: selectTab });

    const hasWall = tab === 'playlist';
    const cards = hasWall ? onlineList.items : NO_CARDS;
    const items = useMemo(() => projectHomeCards(cards, {
        kindLabel: kind => t(KIND_LABEL_KEYS[kind]),
        trackCount: count => t('libraryBravais.trackCount', { count }),
    }), [cards, t]);

    // 打开卡片：执行时读最新的卡片映射与来源（回调身份稳定，层描述不因它换身份）。
    const latest = useRef({ cards, providerId: online.providerId, homeResources, onOpenGridView });
    latest.current = { cards, providerId: online.providerId, homeResources, onOpenGridView };
    const onOpenItem = useCallback((key: string) => {
        const { cards: currentCards, providerId, homeResources: resources, onOpenGridView: open } = latest.current;
        const card = currentCards.find(candidate => homeCardItemKey(candidate) === key);
        if (card) void resources.actions.openOnlineCard(card, providerId, open);
    }, []);

    const status = !hasWall
        ? t('libraryBravais.tabPending')
        : items.length === 0
            ? (onlineList.isLoading ? t('playlist.loading') : onlineList.emptyMessage)
            : undefined;
    const seam = useMemo<BravaisSeamModel>(() => ({
        title: t('libraryBravais.homeTitle'),
        crumb: t('libraryBravais.homeTitle'),
        meta: online.providerLabel,
        status,
        tabs: tabs.map(candidate => ({
            key: candidate.key,
            label: candidate.label,
            active: candidate.key === tab,
            disabled: Boolean(candidate.disabledReason),
        })),
        onSelectTab: key => { selectTab(key as LibraryHomeTabKey); },
    }), [online.providerLabel, selectTab, status, t, tab, tabs]);

    const layer = useMemo<BravaisLayer>(() => ({
        key: `home:${tab}`,
        sessionKey: 'home',
        surface: 'home',
        mode: 'infinite',
        items,
        seam,
        isInteractive,
        focusedEntryKey: null,
        nowPlayingKey: null,
        queuedKeys: NO_KEYS,
        onOpenItem,
    }), [isInteractive, items, onOpenItem, seam, tab]);
    useBravaisLayerRegistration('home', layer);

    return (
        <div
            data-library-home="bravais"
            data-library-renderer="bravais"
            data-library-surface="home"
            data-ponder-page-scope="none"
            aria-hidden
            className="pointer-events-none absolute inset-0"
        />
    );
};

export default BravaisHome;

import React, { useCallback, useMemo, useRef } from 'react';
import { useIsPresent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import type { LibraryCollectionSurfaceProps } from '../../core/contracts/suite';
import { collectionKey } from '../../core/model/collectionIdentity';
import { buildCoreSurfaceParams, buildGridSurfaceState, runGridSurfaceAction } from '../../core/model/collectionSurface';
import { resolveTrackAlbumLink, resolveTrackArtistLinks } from '../../core/model/trackLinks';
import { useCollectionResourceState } from '../../core/bindings/useCollectionResourceState';
import { useCollectionView } from '../../core/bindings/useCollectionView';
import { useCollectionActions } from '../../core/bindings/useCollectionActions';
import { useCollectionMutationSnapshot } from '../../core/bindings/useCollectionMutations';
import { useLocalTrackSortStore } from '../../core/state/useLocalTrackSortStore';
import { useGridSurfaceRegistration } from '../../../hooks/useGridSurfaceRegistration';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';
import type { BravaisLayer, BravaisSeamModel } from './bravaisLayer';
import { collectQueuedKeys, findNowPlayingKey, projectCollectionTracks } from './bravaisProjection';
import { describeBravaisTrack } from './describeBravaisTrack';
import { useBravaisLayerRegistration } from './useBravaisLayerRegistration';
import { useBravaisPlaybackMarks } from './useBravaisPlaybackMarks';
import { useBravaisSessionFocus } from './useBravaisSessionFocus';

// src/library/suites/bravais/BravaisCollection.tsx
// 集合 surface（B6：浏览）。它不画墙：订阅 core binding，把曲目投影成层描述推进 stage store，再向命令面板注册
// 集合动作（按 entry 的声明过滤）。画面上只有一个不可见、铺满的锚点（页面教程的 none 标记与探针要的语义属性）。
// 过滤（有限拼贴）、表单态、列表面板与其余变更动作在 B7。

const NO_KEYS: ReadonlySet<string> = new Set();

const BravaisCollection: React.FC<LibraryCollectionSurfaceProps> = ({
    collection,
    resource,
    playback,
    mutations,
    localSongs,
    isInteractive,
    onBack,
    onDone,
    onOpenAlbum,
    onOpenArtist,
    declaredActions,
}) => {
    const { t } = useTranslation();
    const isPresent = useIsPresent();
    const isActive = isInteractive && isPresent;
    const sessionKey = collectionKey(collection);

    const { snapshot } = useCollectionResourceState(resource);
    const tracks = useMemo(() => snapshot?.tracks ?? [], [snapshot?.tracks]);
    // 与网格、TUI 同一条规则：只有本地文件夹（含「全部歌曲」）按本地排序。
    const supportsLocalTrackSorting = collection.source === 'local' && collection.type === 'folder';
    const sortField = useLocalTrackSortStore(state => state.field);
    const sortDirection = useLocalTrackSortStore(state => state.direction);
    const setSortField = useLocalTrackSortStore(state => state.setField);
    const setSortDirection = useLocalTrackSortStore(state => state.setDirection);
    const localSongsById = useMemo(() => new Map(localSongs?.map(song => [song.id, song])), [localSongs]);
    const localSort = useMemo(() => (
        supportsLocalTrackSorting ? { songsById: localSongsById, field: sortField, direction: sortDirection } : null
    ), [localSongsById, sortDirection, sortField, supportsLocalTrackSorting]);
    // B6 的墙还不做过滤（B7 退化为有限拼贴）：范围就是整个集合，与墙上显示的一致。
    const view = useCollectionView({ tracks, committedQuery: '', localSort });
    const actions = useCollectionActions({ resource, snapshot, view, port: playback, collectionType: collection.type });
    const mutationSnapshot = useCollectionMutationSnapshot(mutations);

    // 命令面板：与 TUI 同一个构建函数，按 entry 的声明过滤（B6 只声明了播放 / 入队范围与条目动作）。
    const surfaceParams = buildCoreSurfaceParams({
        declaredActions,
        supportsLocalTrackSorting,
        canReloadOnlineCollection: actions.capabilities.reload.enabled,
        filteredTrackCount: view.contextTracks.length,
        isFilterActive: view.isFilterActive,
        sortField,
        sortDirection,
        playFiltered: actions.playScope,
        enqueueFiltered: actions.enqueueScope,
        setSortField,
        setSortDirection,
        reloadOnlineCollection: actions.reload,
        mutationSnapshot,
        mutations,
    });
    useGridSurfaceRegistration({
        isInteractive: isActive,
        getState: () => buildGridSurfaceState(surfaceParams),
        run: action => runGridSurfaceAction(action, surfaceParams),
    });

    const focus = useBravaisSessionFocus(sessionKey);
    const { playbackKey, queuedPlaybackKeys } = useBravaisPlaybackMarks();
    const unknownArtist = t('player.unknownArtist');
    const items = useMemo(
        () => projectCollectionTracks(view.displayTracks, view.entryKeyAt, describeBravaisTrack, unknownArtist),
        [unknownArtist, view.displayTracks, view.entryKeyAt],
    );
    const trackByKey = useMemo(() => {
        const map = new Map<string, SongResult>();
        view.displayTracks.forEach((track, index) => {
            const key = view.entryKeyAt(index);
            if (key) map.set(key, track);
        });
        return map;
    }, [view]);
    const nowPlayingKey = useMemo(() => findNowPlayingKey(items, playbackKey), [items, playbackKey]);
    const queuedKeys = useMemo(
        () => (queuedPlaybackKeys.size ? collectQueuedKeys(items, queuedPlaybackKeys) : NO_KEYS),
        [items, queuedPlaybackKeys],
    );

    // 回调身份稳定：执行时读最新的映射、动作与导航（层描述因此只在数据变化时换身份）。
    const latest = useRef({ trackByKey, actions, onOpenAlbum, onOpenArtist, onBack, onDone, declaredActions, focus });
    latest.current = { trackByKey, actions, onOpenAlbum, onOpenArtist, onBack, onDone, declaredActions, focus };
    const callbacks = useMemo(() => {
        const trackOf = (key: string) => latest.current.trackByKey.get(key);
        const declares = (action: 'play' | 'enqueue' | 'open-album' | 'open-artist') => (
            latest.current.declaredActions.actions.includes(action)
        );
        const albumLink = (key: string) => {
            const track = trackOf(key);
            return track && declares('open-album') ? resolveTrackAlbumLink(track, canResolveSongCatalogRef) : null;
        };
        const artistLink = (key: string, index: number) => {
            const track = trackOf(key);
            if (!track || !declares('open-artist')) return null;
            const link = resolveTrackArtistLinks(track, canResolveSongCatalogRef)[index];
            return link && link.targetId !== undefined ? link : null;
        };
        return {
            onPlayItem: (key: string) => {
                const track = trackOf(key);
                if (!track || !declares('play')) return;
                latest.current.focus.persistFocus(key);
                latest.current.actions.playTrack(track);
            },
            onEnqueueItem: (key: string) => {
                const track = trackOf(key);
                if (track && declares('enqueue')) latest.current.actions.enqueueTrack(track);
            },
            canOpenAlbum: (key: string) => Boolean(albumLink(key)),
            onOpenAlbum: (key: string) => {
                const track = trackOf(key);
                const link = albumLink(key);
                if (!track || !link) return;
                latest.current.focus.persistFocus(key);
                latest.current.onOpenAlbum(link.targetId, { ...link.album }, track);
            },
            canOpenArtist: (key: string, index: number) => Boolean(artistLink(key, index)),
            onOpenArtist: (key: string, index: number) => {
                const track = trackOf(key);
                const link = artistLink(key, index);
                if (!track || !link || link.targetId === undefined) return;
                latest.current.focus.persistFocus(key);
                latest.current.onOpenArtist(link.targetId, { ...link.artist }, track);
            },
            onFocusEntry: (key: string | null) => latest.current.focus.noteFocus(key),
            onBack: () => latest.current.onBack(),
            onDone: () => latest.current.onDone(),
            onPlayScope: () => latest.current.actions.playScope(),
            onEnqueueScope: () => latest.current.actions.enqueueScope(),
        };
    }, []);

    const isLoading = !snapshot || snapshot.status === 'idle' || snapshot.status === 'loading';
    const status = snapshot?.error
        ? (snapshot.error.kind === 'not-public' ? t('playlist.loadNotPublic') : t('playlist.loadFailed', { error: snapshot.error.message }))
        : isLoading && items.length === 0
            ? t('playlist.loading')
            : items.length === 0 ? t('libraryBravais.emptyCollection') : undefined;
    const title = mutationSnapshot.renamedTo ?? collection.name;
    const scopeEnabled = actions.capabilities.scope.enabled;
    const declaresScope = declaredActions.actions.includes('play-scope');
    const declaresEnqueueScope = declaredActions.actions.includes('enqueue-scope');
    const seam = useMemo<BravaisSeamModel>(() => ({
        title,
        crumb: title,
        meta: t('libraryBravais.trackCount', { count: items.length }),
        status,
        onPlayScope: declaresScope && scopeEnabled ? callbacks.onPlayScope : undefined,
        onEnqueueScope: declaresEnqueueScope && scopeEnabled ? callbacks.onEnqueueScope : undefined,
    }), [callbacks, declaresEnqueueScope, declaresScope, items.length, scopeEnabled, status, t, title]);

    const layer = useMemo<BravaisLayer>(() => ({
        key: sessionKey,
        sessionKey,
        surface: 'collection',
        mode: 'infinite',
        items,
        seam,
        isInteractive: isActive,
        focusedEntryKey: focus.initialKey,
        nowPlayingKey,
        queuedKeys,
        onPlayItem: callbacks.onPlayItem,
        onEnqueueItem: callbacks.onEnqueueItem,
        canOpenAlbum: callbacks.canOpenAlbum,
        onOpenAlbum: callbacks.onOpenAlbum,
        canOpenArtist: callbacks.canOpenArtist,
        onOpenArtist: callbacks.onOpenArtist,
        onFocusEntry: callbacks.onFocusEntry,
        onBack: callbacks.onBack,
        onDone: callbacks.onDone,
    }), [callbacks, focus.initialKey, isActive, items, nowPlayingKey, queuedKeys, seam, sessionKey]);
    useBravaisLayerRegistration('top', layer, isPresent);

    // 不可见的锚点：铺满但不接指针，画面全在 stage 里。Ponder 的 none 标记要有尺寸才参与解析。
    return (
        <div
            data-library-renderer="bravais"
            data-library-surface="collection"
            data-ponder-page-scope="none"
            data-bravais-layer={sessionKey}
            aria-hidden
            className="pointer-events-none fixed inset-0"
        />
    );
};

export default BravaisCollection;

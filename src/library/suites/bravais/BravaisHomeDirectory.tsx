import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryDirectoryBatchConfig, LibraryHiddenScope } from '../../core/contracts/directory';
import type { LibraryHomeCard } from '../../core/contracts/homeModel';
import type { LibraryDeclaredActions } from '../../core/contracts/suite';
import { isHideableDirectoryItem } from '../../core/model/directoryVisibility';
import { useLibraryDirectorySessionStore } from '../../core/state/useLibraryDirectorySessionStore';
import { useLibraryDirectoryQuery } from '../../core/bindings/useLibraryDirectoryQuery';
import { useLibraryDirectorySelection } from '../../core/bindings/useLibraryDirectorySelection';
import { useLibraryDirectoryVisibility } from '../../core/bindings/useLibraryDirectoryVisibility';
import { useLibraryDirectoryScope } from '../../core/bindings/useLibraryDirectoryScope';
import { useLibraryDirectoryActions } from '../../core/bindings/useLibraryDirectoryActions';
import { useHiddenCollections } from '../../core/bindings/useHiddenCollections';
import { useCommittedQuery } from '../../core/bindings/useCommittedQuery';
import { useGridCommandFilter } from '../../../hooks/useGridCommandFilter';
import { openCommandFilter } from '../../../stores/useAppViewStore';
import type { BravaisItemKind, BravaisLayer, BravaisSeamModel } from './bravaisLayer';
import type { BravaisHomeAccount, BravaisHomeSection, BravaisHomeTool } from './bravaisHomeModels';
import type { BravaisLayerEntries, BravaisSeamFilter, BravaisSeamMenuItem } from './bravaisSeamModels';
import { createHomeItemCache, projectHomeWallItems, resolveHomeWallMode, toHomeEntry } from './bravaisHomeProjection';
import type { BravaisHomeChrome } from './useBravaisHomeChrome';
import { useBravaisDirectoryPanel } from './useBravaisDirectoryPanel';
import { useBravaisHomeDirectorySurface } from './useBravaisHomeDirectorySurface';
import { useBravaisLayerRegistration } from './useBravaisLayerRegistration';
import { bravaisFilterAnchorRef, useBravaisUiStore } from './bravaisUiStore';
import { closeBravaisPanel, openBravaisPanel } from './bravaisPanelHistory';
import { useBravaisSeamStore } from './bravaisSeamLevel';

// src/library/suites/bravais/BravaisHomeDirectory.tsx
// 首页一个来源的墙（设计稿 §10.5）：当前页签 / section 的卡片就是一个目录（与 GridMap、TUI 读写同一份目录会话：
// 隐藏视图、批选、目录过滤，换 suite 不丢），投影成首页层推进 stage。墙一直是这个目录（显示它就 openDirectory 它）。
// - 浏览：去掉隐藏的，无限拼贴；歌单类磁贴悬停右上角有眼睛按钮（隐藏后那一格翻成墙面、后面的 rank 前移）。
// - 管理隐藏（视图模式，不是导航）：整面翻牌，已隐藏的也翻上来、灰度 + 半透明，眼睛按钮常驻、原地变色不重排；
//   「只看隐藏」退化为有限拼贴；退出整面翻回浏览。
// - 目录树面板（本地有批量的几行，窄缝的 ▤）= 批量模式：面板一打开墙就退化为以缝为中心的有限拼贴，没选中的灰度 +
//   半透明，点卡片只切换选中；面板里的输入框是目录过滤（命令面板的内联框画在面板的过滤位上）。关面板 = 退出批量模式：
//   丢掉选择与目录过滤，翻回无限拼贴。
// 这个组件只渲染 null；被探针读 props（directoryKey、items、hiddenScope、batchConfig、layerKey、onOpen）。

const NO_KEYS: ReadonlySet<string> = new Set();

const KIND_LABEL_KEYS: Record<BravaisItemKind, string> = {
    track: 'libraryBravais.kind.track',
    playlist: 'libraryBravais.kind.playlist',
    album: 'libraryBravais.kind.album',
    artist: 'libraryBravais.kind.artist',
    folder: 'libraryBravais.kind.folder',
    feed: 'libraryBravais.kind.feed',
};

export type BravaisHomeDirectoryProps = {
    chrome: BravaisHomeChrome;
    /** 首页层的身份：`home:<页签>`（本地四行、Navidrome 的 section 不换层，只整面翻牌）。 */
    layerKey: string;
    /** 二级切换的 section（在线页签给页签自己）：进了墙的过滤身份。 */
    section: string;
    directoryKey: string;
    hiddenScope: LibraryHiddenScope;
    /** 当前页签 / section 的全部卡片（隐藏的也在）。 */
    items: LibraryHomeCard[];
    isLoading: boolean;
    /** 没有卡片时缝里的说明（未登录、未配置、空曲库、空列表）。 */
    emptyMessage: string;
    /** 缝的元数据行（来源）。 */
    meta: string;
    sections?: readonly BravaisHomeSection[];
    onSelectSection?: (key: string) => void;
    menu?: readonly BravaisSeamMenuItem[];
    /** 来源自己的按钮（Navidrome 的刷新），插在搜索之后、app 入口之前。 */
    sourceTools?: readonly BravaisHomeTool[];
    account?: BravaisHomeAccount | null;
    /** 本地 folders / albums / artists 的批量配置（有它才有目录树面板）。 */
    batchConfig?: LibraryDirectoryBatchConfig;
    /** 面板标题（section 名）。 */
    panelTitle: string;
    declaredActions: LibraryDeclaredActions;
    isInteractive: boolean;
    onOpen: (card: LibraryHomeCard) => void;
    /** 点了直接播放、不进新层的卡（私人 FM）。 */
    isDirect?: (card: LibraryHomeCard) => boolean;
};

const never = () => false;

const BravaisHomeDirectory: React.FC<BravaisHomeDirectoryProps> = ({
    chrome,
    layerKey,
    section,
    directoryKey,
    hiddenScope,
    items,
    isLoading,
    emptyMessage,
    meta,
    sections,
    onSelectSection,
    menu,
    sourceTools,
    account,
    batchConfig,
    panelTitle,
    declaredActions,
    isInteractive,
    onOpen,
    isDirect = never,
}) => {
    const { t } = useTranslation();

    // 墙显示的就是打开着的目录（与 TUI 一样；已经打开着——例如刚从网格的 GridMap 切过来——就接着用它的会话）。
    useEffect(() => {
        useLibraryDirectorySessionStore.getState().openDirectory(directoryKey);
    }, [directoryKey]);

    const panelFor = useBravaisUiStore(state => state.panelFor);
    const panelOpen = Boolean(batchConfig) && panelFor === layerKey;
    const openPanel = useCallback(() => {
        if (!batchConfig) return;
        if (useBravaisSeamStore.getState().level !== 'full') useBravaisSeamStore.getState().setLevel('full');
        openBravaisPanel(layerKey);
    }, [batchConfig, layerKey]);
    // 面板开在这一层、但这一行没有批量（切到了本地歌单）：收起它。
    useEffect(() => {
        if (!batchConfig && useBravaisUiStore.getState().panelFor === layerKey) closeBravaisPanel();
    }, [batchConfig, layerKey]);

    const { query, setQuery, port } = useLibraryDirectoryQuery(directoryKey);
    useGridCommandFilter({
        isInteractive: isInteractive && panelOpen,
        port,
        anchorRef: bravaisFilterAnchorRef,
        reopenIfFiltered: true,
        onFocusResults: () => useBravaisUiStore.getState().focusFirst?.() ?? false,
    });
    const committedQuery = useCommittedQuery(query);
    // 目录过滤只在批量模式里生效（首页不注册过滤；从网格带过来的过滤词在面板打开之前不作用于墙）。
    const effectiveQuery = panelOpen ? committedQuery : '';
    const { selectedIds, setSelected, toggleSelected, replaceSelection } = useLibraryDirectorySelection(directoryKey);
    const { visibilityMode, setVisibilityMode, toggleManageHidden, toggleHiddenOnly } = useLibraryDirectoryVisibility(directoryKey);
    const { hiddenIds, toggleHidden } = useHiddenCollections(hiddenScope);

    // 关面板 = 退出批量模式：丢掉选择与目录过滤（与关掉 GridMap 丢掉会话同一条规则），墙翻回无限拼贴。
    const panelOpenRef = useRef(panelOpen);
    useEffect(() => {
        const wasOpen = panelOpenRef.current;
        panelOpenRef.current = panelOpen;
        if (wasOpen && !panelOpen) useLibraryDirectorySessionStore.getState().clearSession(directoryKey);
    }, [directoryKey, panelOpen]);

    const entries = useMemo(() => items.map(toHomeEntry), [items]);
    const hasHideableItems = useMemo(() => entries.some(isHideableDirectoryItem), [entries]);
    const { visibleItems, displayItems, context } = useLibraryDirectoryScope({
        items: entries,
        hiddenIds,
        visibilityMode,
        query: effectiveQuery,
        selectedIds,
    });
    const { capabilities, run } = useLibraryDirectoryActions(batchConfig, context);

    const filter = useMemo<BravaisSeamFilter>(() => ({
        query,
        placeholder: t('libraryBravaisHome.filterPlaceholder'),
        matchLabel: `${displayItems.length} / ${visibleItems.length}`,
        clearLabel: t('libraryBravaisCollection.clearFilter'),
        onOpen: openCommandFilter,
        onClear: () => setQuery(''),
    }), [displayItems.length, query, setQuery, t, visibleItems.length]);

    const directoryPanel = useBravaisDirectoryPanel({
        directoryKey,
        batchConfig,
        panelOpen,
        title: panelTitle,
        displayItems,
        query: effectiveQuery,
        selectedIds,
        context,
        capabilities,
        run,
        setSelected,
        toggleSelected,
        replaceSelection,
        filter,
        openPanel,
    });

    // 墙上键盘焦点的那一张（命令面板「隐藏焦点歌单」用）。
    const [focusedKey, setFocusedKey] = useState<string | null>(null);
    const focusedEntry = useMemo(() => (focusedKey ? displayItems.find(entry => entry.itemKey === focusedKey) ?? null : null), [displayItems, focusedKey]);
    useBravaisHomeDirectorySurface({
        isInteractive,
        directoryKey,
        declaredActions,
        capabilities,
        context,
        displayItems,
        selectedIds,
        visibilityMode,
        hasHideableItems,
        focusedEntry,
        openPanel,
        replaceSelection,
        toggleManageHidden,
        toggleHidden,
        requestRemove: directoryPanel.requestRemove,
        runAction: directoryPanel.runAction,
    });

    // ---- 墙 ----
    const labels = useMemo(() => ({
        kindLabel: (kind: BravaisItemKind) => t(KIND_LABEL_KEYS[kind]),
        trackCount: (count: number) => t('libraryBravais.trackCount', { count }),
    }), [t]);
    const cacheRef = useRef(createHomeItemCache());
    const isDirectRef = useRef(isDirect);
    isDirectRef.current = isDirect;
    const wallItems = useMemo(() => projectHomeWallItems(displayItems, {
        hiddenIds,
        visibilityMode,
        selectedIds: panelOpen ? selectedIds : null,
        isDirect: card => isDirectRef.current(card),
    }, labels, cacheRef.current), [displayItems, hiddenIds, labels, panelOpen, selectedIds, visibilityMode]);
    const { mode, filterKey } = resolveHomeWallMode({ section, visibilityMode, batch: panelOpen, query: effectiveQuery });
    const planCount = mode === 'finite' ? visibleItems.length : undefined;
    const wall = useMemo(() => ({
        filterKey,
        planCount,
        loading: isLoading && items.length === 0,
    }), [filterKey, isLoading, items.length, planCount]);

    // 回调执行时读最新的映射（身份稳定，层描述不因它们换身份）。
    const latest = useRef({ displayItems, onOpen, toggleHidden });
    latest.current = { displayItems, onOpen, toggleHidden };
    const onOpenItem = useCallback((key: string) => {
        const entry = latest.current.displayItems.find(candidate => candidate.itemKey === key);
        if (entry) latest.current.onOpen(entry.card);
    }, []);
    const onToggleHidden = useCallback((key: string) => {
        const entry = latest.current.displayItems.find(candidate => candidate.itemKey === key);
        if (entry) latest.current.toggleHidden(entry);
    }, []);

    // ---- 缝 ----
    const tools = useMemo<BravaisHomeTool[]>(() => [
        chrome.searchTool,
        ...(batchConfig ? [{
            id: 'directory' as const,
            label: t('libraryBravaisHome.directory'),
            pressed: panelOpen,
            run: () => (useBravaisUiStore.getState().panelFor === layerKey ? closeBravaisPanel() : openPanel()),
        }] : []),
        ...(hasHideableItems ? [{
            id: 'manage-hidden' as const,
            label: t('libraryBravaisHome.manageHidden'),
            pressed: visibilityMode !== 'browse',
            run: toggleManageHidden,
        }] : []),
        ...(sourceTools ?? []),
        ...chrome.appTools,
    ], [batchConfig, chrome.appTools, chrome.searchTool, hasHideableItems, layerKey, openPanel, panelOpen, sourceTools, t, toggleManageHidden, visibilityMode]);
    const manage = useMemo(() => (visibilityMode === 'browse' ? null : {
        mode: visibilityMode,
        title: t('libraryBravaisHome.manageHidden'),
        hiddenOnlyLabel: t('libraryBravaisHome.hiddenOnly'),
        doneLabel: t('libraryBravaisHome.manageDone'),
        onToggleHiddenOnly: toggleHiddenOnly,
        onDone: () => setVisibilityMode('browse'),
    }), [setVisibilityMode, t, toggleHiddenOnly, visibilityMode]);
    const status = displayItems.length > 0
        ? undefined
        : isLoading
            ? t('playlist.loading')
            : effectiveQuery ? t('home.gridSearchNoResults') : emptyMessage;
    const seam = useMemo<BravaisSeamModel>(() => ({
        title: chrome.title,
        crumb: chrome.title,
        meta,
        status,
        tabs: chrome.tabs,
        onSelectTab: chrome.onSelectTab,
        home: {
            sections,
            onSelectSection,
            tools,
            menu,
            menuLabel: t('libraryBravaisHome.more'),
            manage,
            scan: chrome.scan,
            search: chrome.search,
            account,
        },
    }), [account, chrome.onSelectTab, chrome.scan, chrome.search, chrome.tabs, chrome.title, manage, menu, meta, onSelectSection, sections, status, t, tools]);

    const entriesModel = useMemo<BravaisLayerEntries>(() => ({
        hasPanel: Boolean(batchConfig),
        panelTitle,
        listCrumb: t('libraryBravaisHome.directoryCrumb'),
        hasQuery: panelOpen && Boolean(query),
        clearQuery: () => setQuery(''),
        hasForm: directoryPanel.hasForm,
        cancelForm: directoryPanel.cancelForm,
        hasViewMode: visibilityMode !== 'browse',
        exitViewMode: () => setVisibilityMode('browse'),
    }), [batchConfig, directoryPanel.cancelForm, directoryPanel.hasForm, panelOpen, panelTitle, query, setQuery, setVisibilityMode, t, visibilityMode]);

    const home = useMemo(() => ({
        panel: directoryPanel.panel,
        batch: directoryPanel.batch,
        onToggleHidden: hasHideableItems ? onToggleHidden : undefined,
        cycleTab: chrome.cycleTab,
    }), [chrome.cycleTab, directoryPanel.batch, directoryPanel.panel, hasHideableItems, onToggleHidden]);

    const layer = useMemo<BravaisLayer>(() => ({
        key: layerKey,
        sessionKey: 'home',
        surface: 'home',
        mode,
        items: wallItems,
        seam,
        isInteractive,
        focusedEntryKey: null,
        nowPlayingKey: null,
        queuedKeys: NO_KEYS,
        onOpenItem,
        onFocusEntry: setFocusedKey,
        wall,
        entries: entriesModel,
        home,
    }), [entriesModel, home, isInteractive, layerKey, mode, onOpenItem, seam, wall, wallItems]);
    useBravaisLayerRegistration('home', layer);
    return null;
};

export default BravaisHomeDirectory;

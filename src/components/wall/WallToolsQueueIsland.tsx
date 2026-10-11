import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { List, useListRef } from 'react-window';
import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { getSongArtistLabel } from '../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { canSaveQueueAsLocalPlaylist } from '../../utils/queueReorder';
import { QUEUE_ISLAND_ROW_HEIGHT } from './queueDragGeometry';
import { useQueueDragReorder } from './useQueueDragReorder';
import { WallToolsQueueIslandHeader } from './WallToolsQueueIslandHeader';
import { WallToolsQueueRow, type QueueIslandRowActions, type QueueIslandRowProps } from './WallToolsQueueRow';
import type { WallToolsHost } from './wallToolsHost';
import './WallToolsQueueIsland.css';

// src/components/wall/WallToolsQueueIsland.tsx
// 墙面工具面板（WallToolsButton，bravais 与 Lattice 共用）上方的队列浮岛：由快捷排的「队列」格开合（偏好记在
// useLatticeSettingsStore.wallToolsQueueIslandOpen），和面板一起出现、一起收起，私人 FM 下不显示。
// 队列数据直接读 usePlaybackStore（playQueue、currentSong、activePlaybackContext），动作全部经宿主（wallToolsHost）。
// - 头部（WallToolsQueueIslandHeader）：「播放队列 · N 首」、存为本地歌单（内联输入框）、清空（两步确认）。
// - 列表：react-window 虚拟列表，行组件 WallToolsQueueRow；点行播放不跳页；悬停 / 聚焦行出现下一首播放、移到末尾、移除；
//   手柄拖拽排序（useQueueDragReorder）；键盘 Enter 播放、Alt+↑↓ 挪一位并播报、Delete 移除、↑↓ 在行之间移焦，
//   用掉的按键都 preventDefault（bravais 的 window 按键监听认 defaultPrevented）。
// - 滚动：打开后等一帧把当前歌曲滚到正中；切歌时 smart 平滑滚动，拖拽中跳过。
// - Esc 分层：拖拽中只撤拖拽；内联输入 / 清空待确认时只撤这一步；否则交给面板（WallToolsSurface 一起收起面板与浮岛）。
// - 外部舞台播放（activePlaybackContext === 'stage'）时只读：只能点歌播放。

/** 头部高度（px）；浮岛高度 = 头部 + 最多 8 行，至少 112px（窗口矮时由 CSS 只压缩浮岛）。 */
const ISLAND_HEADER_HEIGHT = 36;
const ISLAND_MAX_VISIBLE_ROWS = 8;
const ISLAND_MIN_HEIGHT = 112;

export const queueIslandHeight = (rowCount: number) => Math.max(
    ISLAND_MIN_HEIGHT,
    ISLAND_HEADER_HEIGHT + Math.min(rowCount, ISLAND_MAX_VISIBLE_ROWS) * QUEUE_ISLAND_ROW_HEIGHT,
);

export function WallToolsQueueIsland({ id, host }: { id: string; host: WallToolsHost }) {
    const { t } = useTranslation();
    const playQueue = usePlaybackStore(state => state.playQueue);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const readOnly = usePlaybackStore(state => state.activePlaybackContext === 'stage');
    const currentSongKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    const currentIndex = useMemo(
        () => (currentSongKey ? playQueue.findIndex(song => getPlaybackSongKey(song) === currentSongKey) : -1),
        [currentSongKey, playQueue],
    );
    const canSave = useMemo(
        () => !readOnly && canSaveQueueAsLocalPlaylist(currentSong, playQueue),
        [currentSong, playQueue, readOnly],
    );

    const listRef = useListRef(null);
    const frameRef = useRef<HTMLDivElement>(null);
    // 列表的像素高度：自己量列表外框（窗口矮时浮岛会被压缩），以数字交给 react-window——它拿到的是确定的高度，
    // 打开那一帧的居中滚动就不会落在「还没量完、高度当 0」的那一刻。量到之前先用按行数算出的理想高度。
    const [measuredListHeight, setMeasuredListHeight] = useState<number | null>(null);
    const [announcement, setAnnouncement] = useState({ text: '', nonce: 0 });

    // 行动作与按键处理读这里（身份稳定的 actions 对象，行不因为它重渲染）。
    const latest = useRef({ playQueue, host, readOnly, currentIndex, t });
    latest.current = { playQueue, host, readOnly, currentIndex, t };

    /** 播报一句（每次换一个子节点，同一句连说两次读屏也会再读）。 */
    const announce = useCallback((text: string) => {
        setAnnouncement(previous => ({ text, nonce: previous.nonce + 1 }));
    }, []);

    /** 把第 index 行滚进视口并把焦点放到它的主按钮上（那一行可能要等滚动后才挂载，最多再等两帧）。 */
    const focusRow = useCallback((index: number) => {
        const list = listRef.current;
        if (!list || index < 0 || index >= latest.current.playQueue.length) return;
        list.scrollToRow({ index, align: 'auto', behavior: 'instant' });
        let attempts = 3;
        const tryFocus = () => {
            const button = list.element?.querySelector<HTMLButtonElement>(`[data-queue-index="${index}"] .lattice-tools-island-song`);
            if (button) button.focus({ preventScroll: true });
            else if (--attempts > 0) requestAnimationFrame(tryFocus);
        };
        requestAnimationFrame(tryFocus);
    }, [listRef]);

    const moveSong = useCallback((from: number, to: number) => {
        const { host: currentHost, t: translate } = latest.current;
        currentHost.moveQueueSong(from, to);
        announce(translate('wallTools.queueMoved', { position: to + 1 }));
    }, [announce]);

    const keyAt = useCallback((index: number) => {
        const song = latest.current.playQueue[index];
        return song ? getPlaybackSongKey(song) : null;
    }, []);

    const reorder = useQueueDragReorder({
        captureRef: frameRef,
        getScrollElement: () => listRef.current?.element ?? null,
        rowCount: playQueue.length,
        keyAt,
        onDrop: moveSong,
    });
    const { drag, beginDrag, ghostRef, cancel: cancelDrag, isDragging } = reorder;

    /** 行上的按键：Enter 播放、↑↓ 移焦、Alt+↑↓ 挪一位、Delete 移除；用掉的都 preventDefault。 */
    const handleRowKeyDown = useCallback((index: number, event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return;
        const { playQueue: queue, host: currentHost, readOnly: locked } = latest.current;
        const { key, altKey, shiftKey } = event;
        if (key === 'Enter' && !altKey && !shiftKey) {
            event.preventDefault();
            const song = queue[index];
            if (song) currentHost.playQueueSong(song);
            return;
        }
        if ((key === 'ArrowUp' || key === 'ArrowDown') && !shiftKey) {
            event.preventDefault();
            const target = index + (key === 'ArrowUp' ? -1 : 1);
            if (target < 0 || target >= queue.length) return;
            if (altKey) {
                if (locked) return;
                moveSong(index, target);
            }
            focusRow(target);
            return;
        }
        if (key === 'Delete' && !altKey && !shiftKey && !locked) {
            event.preventDefault();
            currentHost.removeQueueSong(index);
            focusRow(Math.min(index, queue.length - 2));
        }
    }, [focusRow, moveSong]);

    const actions = useMemo<QueueIslandRowActions>(() => ({
        play: index => {
            const song = latest.current.playQueue[index];
            if (song) latest.current.host.playQueueSong(song);
        },
        playNext: index => {
            if (!latest.current.readOnly) latest.current.host.playQueueSongNext(index);
        },
        moveToEnd: index => {
            if (!latest.current.readOnly) latest.current.host.moveQueueSongToEnd(index);
        },
        remove: index => {
            if (!latest.current.readOnly) latest.current.host.removeQueueSong(index);
        },
        keyDown: handleRowKeyDown,
        beginDrag: (index, event) => {
            if (!latest.current.readOnly) beginDrag(index, event);
        },
    }), [beginDrag, handleRowKeyDown]);

    const labels = useMemo<QueueIslandRowProps['labels']>(() => ({
        unavailable: t('status.songUnavailableTag'),
        playNext: t('queue.playNext'),
        moveToEnd: t('queue.moveToEnd'),
        remove: t('queue.remove'),
        dragHandle: t('wallTools.queueDragHandle'),
    }), [t]);

    const rowProps = useMemo<QueueIslandRowProps>(
        () => ({ playQueue, currentSongKey, readOnly, drag, actions, labels }),
        [actions, currentSongKey, drag, labels, playQueue, readOnly],
    );

    useLayoutEffect(() => {
        const frame = frameRef.current;
        if (!frame || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(entries => {
            const height = Math.round(entries[entries.length - 1].contentRect.height);
            setMeasuredListHeight(previous => (previous === height ? previous : height));
        });
        observer.observe(frame);
        return () => observer.disconnect();
    }, []);

    // 打开后等一帧再把当前歌曲滚到正中。
    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            const index = latest.current.currentIndex;
            if (index >= 0) listRef.current?.scrollToRow({ index, align: 'center', behavior: 'instant' });
        });
        return () => cancelAnimationFrame(frame);
    }, [listRef]);

    // 切歌：smart 平滑滚动（已经在视口里就不动）；拖拽中跳过。
    const scrolledKeyRef = useRef(currentSongKey);
    useEffect(() => {
        if (scrolledKeyRef.current === currentSongKey) return;
        scrolledKeyRef.current = currentSongKey;
        if (currentIndex < 0 || isDragging()) return;
        listRef.current?.scrollToRow({ index: currentIndex, align: 'smart', behavior: 'smooth' });
    }, [currentIndex, currentSongKey, isDragging, listRef]);

    // Esc：拖拽中只撤拖拽（捕获阶段，先于头部与面板的监听）。
    const dragging = drag !== null;
    useEffect(() => {
        if (!dragging) return undefined;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing || !isDragging()) return;
            cancelDrag();
            event.preventDefault();
        };
        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [cancelDrag, dragging, isDragging]);

    const count = playQueue.length;
    const ghostSong = drag ? playQueue[drag.from] : undefined;

    return (
        <motion.section
            id={id}
            role="region"
            aria-label={t('wallTools.queueIsland')}
            className="lattice-tools-island"
            data-queue-island=""
            data-queue-readonly={readOnly || undefined}
            style={{ height: queueIslandHeight(count) }}
            initial={{ opacity: 0, scale: 0.96, originX: 1, originY: 1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
        >
            <WallToolsQueueIslandHeader
                host={host}
                count={count}
                readOnly={readOnly}
                canSave={canSave}
                announce={announce}
                isDragging={isDragging}
            />
            <div ref={frameRef} className={drag ? 'lattice-tools-island-list is-dragging' : 'lattice-tools-island-list'}>
                {count === 0 ? (
                    <p className="lattice-tools-island-empty">{t('queue.empty')}</p>
                ) : (
                    <List
                        listRef={listRef}
                        aria-label={t('wallTools.queueIsland')}
                        rowCount={count}
                        rowHeight={QUEUE_ISLAND_ROW_HEIGHT}
                        rowComponent={WallToolsQueueRow}
                        rowProps={rowProps}
                        overscanCount={4}
                        className="lattice-tools-island-scroll custom-scrollbar"
                        style={{ height: measuredListHeight ?? queueIslandHeight(count) - ISLAND_HEADER_HEIGHT }}
                    />
                )}
                {ghostSong && (
                    <div ref={ghostRef} className="lattice-tools-island-ghost" aria-hidden="true">
                        <GripVertical />
                        <span className="lattice-tools-island-text">
                            <span className="lattice-tools-island-name">{ghostSong.name}</span>
                            <span className="lattice-tools-island-artist">{getSongArtistLabel(ghostSong)}</span>
                        </span>
                    </div>
                )}
            </div>
            <div className="sr-only" role="status" aria-live="polite" data-queue-island-live="">
                <span key={announcement.nonce}>{announcement.text}</span>
            </div>
        </motion.section>
    );
}

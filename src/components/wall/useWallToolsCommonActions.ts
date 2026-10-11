import { useSyncExternalStore } from 'react';
import { Disc3, ListMusic, Shuffle, Sparkles, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import type { WallToolsEntry, WallToolsQuickAction } from './WallToolsRows';
import { useWallToolsHost, type WallToolsHostSnapshot } from './wallToolsHost';

// src/components/wall/useWallToolsCommonActions.ts
// 墙面工具面板里与墙无关的公共部分（两面墙一样）：快捷排的洗牌、主题、队列、播放器四格，以及音量滑条。
// 动作来自宿主（wallToolsHost，App 经 WallToolsDockHost 提供）；没有宿主时（组件探针、Ponder 合成界面）洗牌、主题、
// 播放器三格跳过，队列格照画但禁用，音量照常读写音量 store、只是拖动时不预览。
// 每面墙只给和场景有关的 locate / destination 两格与自己的 entries，由 WallToolsSurface 按固定顺序拼起来。

const NO_HOST_SNAPSHOT: WallToolsHostSnapshot = { themeGeneration: 'unavailable', canShuffleQueue: false };
const noopSubscribe = () => () => {};
const readNoHostSnapshot = () => NO_HOST_SNAPSHOT;

/** 音量图标随显示的值变（与播放页面板的音量行同一套：0 / 静音、小于一半、其余）。 */
const volumeIcon = (value: number) => (value === 0 ? VolumeX : value < 0.5 ? Volume1 : Volume2);

/** 拖动或按键改音量时先解除静音（拖到一个音量就是想听见它）。 */
const unmuteForVolumeChange = () => {
    const audio = useAudioSettingsStore.getState();
    if (audio.isMuted) audio.handleToggleMute();
};

export type WallToolsCommonActions = {
    shuffle: WallToolsQuickAction | null;
    theme: WallToolsQuickAction | null;
    queue: WallToolsQuickAction;
    openPlayer: WallToolsQuickAction | null;
    volume: WallToolsEntry;
};

/** 组装公共的四格与音量（每次渲染重算；只在面板打开时用到）。 */
export const useWallToolsCommonActions = (): WallToolsCommonActions => {
    const { t } = useTranslation();
    const host = useWallToolsHost();
    const snapshot = useSyncExternalStore(host?.subscribe ?? noopSubscribe, host?.getSnapshot ?? readNoHostSnapshot);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const hasCurrentSong = usePlaybackStore(state => state.currentSong !== null);
    const volume = useAudioSettingsStore(state => state.volume);
    const isMuted = useAudioSettingsStore(state => state.isMuted);

    const themeBusy = snapshot.themeGeneration === 'busy';
    const shuffle: WallToolsQuickAction | null = host ? {
        id: 'shuffle-queue',
        icon: Shuffle,
        label: t('wallTools.shuffle'),
        kbd: ': + R',
        disabled: !snapshot.canShuffleQueue,
        status: snapshot.canShuffleQueue ? undefined : t('wallTools.shuffleUnavailable'),
        // 不收起：洗完还能再洗一次，提示条报「播放队列已打乱」。
        keepOpen: true,
        onSelect: host.shuffleQueue,
    } : null;
    const theme: WallToolsQuickAction | null = host ? {
        id: 'generate-theme',
        icon: Sparkles,
        label: t('wallTools.theme'),
        disabled: snapshot.themeGeneration !== 'ready',
        busy: themeBusy,
        status: themeBusy
            ? t('wallTools.themeBusy')
            : snapshot.themeGeneration === 'unavailable' ? t('wallTools.themeUnavailable') : undefined,
        // 不收起：让人看到「生成中」，生成完按钮恢复。
        keepOpen: true,
        onSelect: host.generateTheme,
    } : null;
    // 私人 FM 没有可编辑的队列：禁用并写原因。
    const queue: WallToolsQuickAction = {
        id: 'queue',
        icon: ListMusic,
        label: t('wallTools.queue'),
        disabled: !host || isFmMode,
        status: host && isFmMode ? t('wallTools.queueUnavailableInFm') : undefined,
        // 不收起：队列浮岛叠在面板上面，和面板一起开着。
        keepOpen: true,
        // TODO(墙面工具第二步): 在这里开合队列浮岛（WallToolsQueueIsland），并带上 expanded / controls。
        onSelect: () => {},
    };
    const openPlayer: WallToolsQuickAction | null = host ? {
        id: 'open-player',
        icon: Disc3,
        label: t('wallTools.openPlayer'),
        disabled: !hasCurrentSong,
        status: hasCurrentSong ? undefined : t('wallTools.openPlayerUnavailable'),
        onSelect: host.openPlayer,
    } : null;

    const volumeEntry: WallToolsEntry = {
        kind: 'slider',
        id: 'volume',
        label: t('ui.volume'),
        value: isMuted ? 0 : volume,
        icon: Volume2,
        iconFor: volumeIcon,
        iconAction: {
            label: isMuted ? t('wallTools.unmute') : t('wallTools.mute'),
            pressed: isMuted,
            onPress: () => useAudioSettingsStore.getState().handleToggleMute(),
        },
        formatValue: value => (isMuted ? t('wallTools.muted') : `${Math.round(value * 100)}%`),
        onPreview: value => {
            unmuteForVolumeChange();
            host?.previewVolume(value);
        },
        onCommit: value => {
            unmuteForVolumeChange();
            useAudioSettingsStore.getState().handleSetVolume(value);
        },
    };

    return { shuffle, theme, queue, openPlayer, volume: volumeEntry };
};

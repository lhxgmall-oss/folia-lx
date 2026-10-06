import type { BravaisLayerEntries, BravaisLayerWall, BravaisSeamArtist, BravaisSeamCollection } from './bravaisSeamModels';

// src/library/suites/bravais/bravaisLayer.ts
// bravais 的层描述（设计稿 §8.1）：surface 把 core binding 的数据投影成它，推进 bravaisStageStore，stage 只读它画墙。
// 层描述里只有已投影的展示数据和回调——没有资源对象、没有控制器：stage 不知道数据从哪来，也不直接改任何东西。
// 回调的参数一律是条目 key（BravaisItem.key），surface 自己把 key 映射回曲目 / 卡片。

/** 磁贴上的内容种类（设计稿 §6；'wall' 留白由 stage 自己画，不出现在条目里）。 */
export type BravaisItemKind = 'track' | 'playlist' | 'album' | 'artist' | 'folder' | 'feed';

/** 墙上一张磁贴的内容。 */
export type BravaisItem = {
    /** 层内唯一的 key：集合是条目键（core 的 entryKey），首页卡片是 `card:<id>`。翻牌按它判断「内容变了没有」。 */
    key: string;
    kind: BravaisItemKind;
    title: string;
    subtitle: string;
    coverUrl?: string;
    /** 徽标文字：集合是条目序号（01、02…），首页是种类（歌单 / 专辑…）。 */
    badge: string;
    /** 歌曲的播放键（getPlaybackSongKey）：与正在播放的那首比较。 */
    playbackKey?: string;
    /** 聚焦卡上的专辑 / 歌手链接与时长（只有歌曲有）。 */
    album?: string;
    artists?: readonly string[];
    durationLabel?: string;
    /** 不可播放（灰显）。 */
    unavailable?: boolean;
};

/** 首页缝里的页签（只有首页层有）。 */
export type BravaisSeamTab = {
    key: string;
    label: string;
    active: boolean;
    disabled: boolean;
};

/** 缝里画什么（设计稿 §5「内容」）。文案都是已翻译的。 */
export type BravaisSeamModel = {
    /** 竖排主标题。 */
    title: string;
    /** 面包屑最后一级（首页为「书库」）。 */
    crumb: string;
    /** 元数据行：曲目数、来源等。 */
    meta: string;
    /** 状态行（加载中、错误、空、本页签还没有墙面）；没有就不显示。 */
    status?: string;
    tabs?: readonly BravaisSeamTab[];
    onSelectTab?: (key: string) => void;
    /** 播放 / 加入当前范围；没声明或不可用时不给。 */
    onPlayScope?: () => void;
    onEnqueueScope?: () => void;
    /** B7 集合页：收藏星标、补页进度、状态与结果提示、过滤位、日期步进、「⋯ 更多」、表单态（见 bravaisSeamModels）。 */
    collection?: BravaisSeamCollection;
    /** B8 歌手页：头像、别名、简介与统计（ArtistGridView 的信息）。 */
    artist?: BravaisSeamArtist;
    /** B8：播放 / 加入当前范围的按钮文案（歌手页是「播放热门」「加入热门歌曲」）；不给就是「播放全部」「加入队列」。 */
    scopeLabels?: { play: string; enqueue: string };
};

export type BravaisLayerSurface = 'home' | 'collection' | 'artist';

/** 一层墙的描述。 */
export type BravaisLayer = {
    /** 层身份：首页是 `home:<页签>`，集合是会话键（collectionKey）。换了就是换层。 */
    key: string;
    /** 布局记忆与 layout.forget 用的会话键（首页为 'home'）。 */
    sessionKey: string;
    surface: BravaisLayerSurface;
    /** B6 只有无限拼贴；有限拼贴（过滤、搜索）在 B7 接上。 */
    mode: 'infinite' | 'finite';
    items: readonly BravaisItem[];
    seam: BravaisSeamModel;
    /** surface 自己的 isInteractive（首页在集合层打开时为 false）。 */
    isInteractive: boolean;
    /** 会话里记着的焦点条目（进入时如果没有起点磁贴，键盘焦点落在它上面）。 */
    focusedEntryKey: string | null;
    /** 正在播放的那首在这一层里的条目 key（没有就是 null）。 */
    nowPlayingKey: string | null;
    /** 已在播放队列里的条目 key（聚焦卡显示「✓ 已在队列」）。 */
    queuedKeys: ReadonlySet<string>;
    /** 打开一个非歌曲条目（歌单 / 专辑卡）：push 下一层。 */
    onOpenItem?: (key: string) => void;
    onPlayItem?: (key: string) => void;
    onEnqueueItem?: (key: string) => void;
    /** 聚焦卡上的专辑 / 歌手链接；能不能打开由 surface 判定（canOpen*）。 */
    canOpenAlbum?: (key: string) => boolean;
    onOpenAlbum?: (key: string) => void;
    canOpenArtist?: (key: string, index: number) => boolean;
    onOpenArtist?: (key: string, index: number) => void;
    /** 键盘焦点换到了这一项（低频、离散）：surface 记下，离开时按会话的代写回。 */
    onFocusEntry?: (key: string | null) => void;
    /** Esc 阶梯的最后一步（离开但保留）。首页没有。 */
    onBack?: () => void;
    /** 缝里的返回按钮（完成：宿主清会话、忘布局）。首页没有。 */
    onDone?: () => void;
    /** B7：墙的内容规则（无限拼贴的循环周期、有限拼贴的规划条目数、过滤身份、加载呼吸）。 */
    wall?: BravaisLayerWall;
    /** B7：列表面板与条目动作（聚焦卡「⋯」、Esc 阶梯的过滤词一级）。 */
    entries?: BravaisLayerEntries;
};


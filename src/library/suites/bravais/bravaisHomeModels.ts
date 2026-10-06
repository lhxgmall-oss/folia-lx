import type { LibraryDirectoryVisibilityMode } from '../../core/contracts/directory';
import type { BravaisSeamFilter, BravaisSeamForm, BravaisSeamMenuItem, BravaisSeamNotice } from './bravaisSeamModels';

// src/library/suites/bravais/bravaisHomeModels.ts
// B9 首页挂在层描述上的扩展类型（设计稿 §10.5、§5「面板」的目录树）：首页窄缝里的二级切换、工具按钮（搜索、目录、
// 管理隐藏、Navidrome 刷新、app 级入口）、本地「⋯」、管理隐藏视图、扫描进度、全局搜索框、给 B10 账户留的位置；
// 目录树面板（GridMap 的批量模式）的行、全选、底部批量操作与表单态；批量模式下墙上的选择动作。
// 都是已翻译的文案与身份稳定的回调，stage 只读、只调。

/** 缝里的二级切换：本地四行（文件夹 / 专辑 / 歌手 / 歌单）、Navidrome 的 section。切换 = 整面翻牌，不换层。 */
export type BravaisHomeSection = { key: string; label: string; active: boolean };

/** 首页窄缝的工具按钮（图标按钮，文案是标题与读屏名）。 */
export type BravaisHomeToolId =
    | 'search'
    | 'directory'
    | 'manage-hidden'
    | 'refresh-navidrome'
    | 'queue'
    | 'player'
    | 'stage'
    | 'settings';

export type BravaisHomeTool = {
    id: BravaisHomeToolId;
    label: string;
    /** 开关类（管理隐藏、目录）此刻按下。 */
    pressed?: boolean;
    disabled?: boolean;
    /** 进行中（刷新）：图标转圈。 */
    busy?: boolean;
    run: () => void;
};

/** 管理隐藏视图（视图模式，不是导航）：缝里「只看隐藏」开关与「完成」。 */
export type BravaisHomeManage = {
    mode: Exclude<LibraryDirectoryVisibilityMode, 'browse'>;
    title: string;
    hiddenOnlyLabel: string;
    doneLabel: string;
    onToggleHiddenOnly: () => void;
    onDone: () => void;
};

/**
 * 全局搜索（设计稿 §10.5「全局搜索的过渡方案」）：缝里 ⌕ 展开成完整宽度的搜索框，提交走宿主的 onSearchCommitted，
 * 跳到 SearchWorkspace——过渡期唯一的离墙路径（计划完成标准 5）。search surface 落地后改成墙内的搜索层。
 */
export type BravaisHomeSearch = {
    title: string;
    placeholder: string;
    submitLabel: string;
    closeLabel: string;
    onSubmit: (query: string) => void;
};

/**
 * 给 B10 账户留的位置：首页在线页签（歌单 / 电台 / 专辑）窄缝里的平台切换。B9 只渲染一个空容器
 * （BravaisSeamAccountSlot，`data-bravais-account-slot=<providerId>`），本地 / Navidrome 页签不给。
 * B10 在这里补平台列表、当前平台、登出与登录入口（account-select / account-logout），登录态与确认态是缝的表单态。
 */
export type BravaisHomeAccount = {
    providerId: string;
    providerLabel: string;
};

/** 首页层在缝里的那一部分（BravaisSeamModel.home）。 */
export type BravaisHomeSeam = {
    /** 二级切换（在线页签没有）。 */
    sections?: readonly BravaisHomeSection[];
    onSelectSection?: (key: string) => void;
    tools: readonly BravaisHomeTool[];
    /** 本地「⋯」：导入文件夹、刷新、导入歌单文件。 */
    menu?: readonly BravaisSeamMenuItem[];
    menuLabel: string;
    /** 管理隐藏视图开着时的开关（浏览时为 null）。 */
    manage?: BravaisHomeManage | null;
    /** 元数据行：扫描进度（本地导入 / 重扫时）。 */
    scan?: string | null;
    search: BravaisHomeSearch;
    /** B10 的账户位（只有在线页签有）。 */
    account?: BravaisHomeAccount | null;
};

/** 目录树面板里的一行（本地文件夹是树；专辑 / 歌手是平铺的条目）。 */
export type BravaisDirectoryRow = {
    /** 行 key（core/model/directoryTree：条目是 `item:<id>`，树节点是 `node:<id>`）。 */
    key: string;
    label: string;
    detail: string;
    depth: number;
    /** 三态（加「仅本层」）：按子树下显示着的文件夹卡片计算。 */
    selection: 'none' | 'partial' | 'direct' | 'all';
    /** 子树下没有可选的卡片。 */
    selectable: boolean;
    expandable: boolean;
    expanded: boolean;
    ignored: boolean;
    /** 导入根（深度 0、没被忽略）：悬停时有「重新扫描」「移除根」。 */
    rootPath?: string;
    /** 被忽略的文件夹：悬停时有「恢复」。 */
    ignoredPath?: string;
};

export type BravaisDirectoryActionId = 'play' | 'enqueue' | 'create-playlist' | 'remove' | 'clear';

export type BravaisDirectoryPanel = {
    title: string;
    /** 「已选 N / 共 M · K 首」。 */
    summary: string;
    crumb: string;
    filter: BravaisSeamFilter;
    rows: readonly BravaisDirectoryRow[];
    emptyLabel: string;
    selectAll: { state: 'none' | 'partial' | 'all'; label: string; toggle: () => void };
    onToggleRow: (rowKey: string) => void;
    onToggleExpanded: (rowKey: string) => void;
    /** 根节点行的悬停操作（文件夹才有）；进行中的根转圈、其余禁用。 */
    roots?: {
        busyPath: string | null;
        disabled: boolean;
        rescanLabel: string;
        removeLabel: string;
        clearIgnoreLabel: string;
        rescan: (rootPath: string) => void;
        remove: (rootPath: string) => void;
        clearIgnore: (path: string) => void;
    };
    actions: readonly { id: BravaisDirectoryActionId; label: string; disabled: boolean; danger?: boolean; run: () => void }[];
    /** 建歌单（输入）、移除所选 / 移除根（确认）：面板底部翻成表单态。 */
    form?: BravaisSeamForm | null;
    notice?: BravaisSeamNotice | null;
};

/** 批量模式（目录树面板开着）下墙与键盘的动作：点卡片只切换选中，绝不进入文件夹。 */
export type BravaisHomeBatch = {
    toggle: (itemKey: string) => void;
    selectAll: () => void;
    play: (enqueue: boolean) => void;
    /** Delete：先翻成确认态。 */
    requestRemove: () => void;
};

/** 首页层的扩展（BravaisLayer.home）。 */
export type BravaisHomeLayer = {
    panel?: BravaisDirectoryPanel | null;
    batch?: BravaisHomeBatch | null;
    /** 歌单类磁贴右上角的眼睛按钮（directory-toggle-hidden）。 */
    onToggleHidden?: (itemKey: string) => void;
    /** F6 / Shift+F6：切到下一个 / 上一个可用页签（没得切时返回 false）。 */
    cycleTab?: (delta: 1 | -1) => boolean;
};

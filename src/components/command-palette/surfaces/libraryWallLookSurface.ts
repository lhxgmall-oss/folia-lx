import type { CommandPaletteCommand, CommandPaletteContext, CommandPaletteMatch } from '../types';
import type { CommandPaletteSurface } from './types';
import {
    LIBRARY_WALL_LOOKS,
    LIBRARY_WALL_WINDOW_COUNTS,
    libraryWallWindowSharePercent,
    type LibraryWallLook,
} from '../../../utils/libraryWallLook';

// src/components/command-palette/surfaces/libraryWallLookSurface.ts
// bravais 透光的两个 picker：档位（实色 / 部分透明 / 全透明）与部分透明时的每块窗数（1–6）。输入框筛选，方向键移动，
// Enter 或点击生效。当前值与 setter 都来自 settings 命名空间（useLibraryWallLookStore 经 context 透出），
// 这里不 import store 或 registry，命令注册表保持纯 TS。两个 picker 共用一个列表视图。

const LOOK_PICK_PREFIX = 'library-wall-look-pick-';
const WINDOWS_PICK_PREFIX = 'library-wall-windows-pick-';

type Translate = CommandPaletteContext['shared']['t'];

const LOOK_TEXT: Record<LibraryWallLook, { label: [string, string]; description: [string, string] }> = {
    solid: {
        label: ['options.libraryWallLookSolid', 'Solid'],
        description: ['options.libraryWallLookSolidDesc', 'Covers the player completely, like Lattice.'],
    },
    partial: {
        label: ['options.libraryWallLookPartial', 'Partly see-through'],
        description: ['options.libraryWallLookPartialDesc', 'Some tiles in each block are windows onto the visualizer.'],
    },
    clear: {
        label: ['options.libraryWallLookClear', 'See-through'],
        description: ['options.libraryWallLookClearDesc', 'Every tile is a window and shows only its title.'],
    },
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** 行的取值（从命令 id 读回，视图用它标记当前项与写 data 属性）。 */
export const readLibraryWallPick = (commandId: string): string => {
    if (commandId.startsWith(LOOK_PICK_PREFIX)) return commandId.slice(LOOK_PICK_PREFIX.length);
    if (commandId.startsWith(WINDOWS_PICK_PREFIX)) return commandId.slice(WINDOWS_PICK_PREFIX.length);
    return '';
};

export const libraryWallLookLabel = (look: LibraryWallLook, t: Translate): string => t(...LOOK_TEXT[look].label);

export const libraryWallWindowsLabel = (count: number, t: Translate): string => (
    t('commandPalette.libraryWallPicker.windows', 'Windows per block: {{count}}').replace('{{count}}', String(count))
);

const activeText = (t: Translate) => t('commandPalette.libraryWallPicker.active', 'In use');

type PickerRow = {
    value: string;
    title: string;
    description: string;
    /** 查询命中的位置（越小越靠前），没命中是 null。查询已经过 normalize。 */
    matchQuery: (normalizedQuery: string) => number | null;
    apply: (context: CommandPaletteContext) => void;
};

/** 在几段文字里找查询最早出现的位置。 */
const firstIndexIn = (haystacks: string[], normalizedQuery: string): number | null => {
    const best = haystacks
        .map(haystack => normalize(haystack).indexOf(normalizedQuery))
        .filter(position => position >= 0)
        .sort((left, right) => left - right)[0];
    return best === undefined ? null : best;
};

const toCommand = (prefix: string, row: PickerRow): CommandPaletteCommand => ({
    id: `${prefix}${row.value}`,
    group: 'settings',
    title: row.title,
    // 文案来自 options.* / commandPalette.libraryWallPicker.*，不是 commandPalette.commands.<id>。
    textSource: 'runtime',
    description: row.description,
    keywords: [row.value],
    execute: (_input, context) => {
        row.apply(context);
        return true;
    },
});

/**
 * 按标题或取值里命中的位置排序；空查询保持声明顺序。
 * @param prefix 行命令 id 的前缀，决定视图读回的取值
 */
const buildRowMatches = (prefix: string, rows: PickerRow[], query: string): CommandPaletteMatch[] => {
    const normalizedQuery = normalize(query);
    return rows
        .map((row, index) => {
            if (!normalizedQuery) return { row, score: 100 - index };
            const best = row.matchQuery(normalizedQuery);
            return best === null ? null : { row, score: 100 - best };
        })
        .filter((entry): entry is { row: PickerRow; score: number } => entry !== null)
        .map(entry => ({ command: toCommand(prefix, entry.row), score: entry.score, input: '' }));
};

const buildLookMatches = (context: CommandPaletteContext, query: string): CommandPaletteMatch[] => {
    const { t } = context.shared;
    const current = context.settings.libraryWallLook();
    const rows = LIBRARY_WALL_LOOKS.map((look): PickerRow => {
        const title = libraryWallLookLabel(look, t);
        return {
            value: look,
            title,
            description: look === current ? activeText(t) : t(...LOOK_TEXT[look].description),
            matchQuery: normalizedQuery => firstIndexIn([title, look], normalizedQuery),
            apply: next => next.settings.setLibraryWallLook(look),
        };
    });
    return buildRowMatches(LOOK_PICK_PREFIX, rows, query);
};

/**
 * 窗数行的命中规则：纯数字 1–6 只命中那一档；带 % 或大于 6 的数字按百分比前缀命中（「33%」「33」→ 4 窗）；
 * 其余文字按标题查找。数字不做子串匹配，免得「5」同时命中 25% 与 50%。
 */
const matchWindowsQuery = (normalizedQuery: string, count: number, percent: number, title: string): number | null => {
    const numeric = /^(\d+)\s*(%?)$/.exec(normalizedQuery);
    if (!numeric) return firstIndexIn([title], normalizedQuery);
    const [, digits, percentSign] = numeric;
    const value = Number(digits);
    if (!percentSign && value >= 1 && value <= LIBRARY_WALL_WINDOW_COUNTS.length) {
        return value === count ? 0 : null;
    }
    return String(percent).startsWith(digits) ? 0 : null;
};

const buildWindowsMatches = (context: CommandPaletteContext, query: string): CommandPaletteMatch[] => {
    const { t } = context.shared;
    const current = context.settings.libraryWallWindowsPerBlock();
    const rows = LIBRARY_WALL_WINDOW_COUNTS.map((count): PickerRow => {
        const percent = libraryWallWindowSharePercent(count);
        const share = t('commandPalette.libraryWallPicker.windowsShare', '{{percent}}% of each block opens onto the visualizer')
            .replace('{{percent}}', String(percent));
        const title = libraryWallWindowsLabel(count, t);
        return {
            value: String(count),
            title,
            description: count === current ? `${activeText(t)} · ${share}` : share,
            matchQuery: normalizedQuery => matchWindowsQuery(normalizedQuery, count, percent, title),
            apply: next => next.settings.setLibraryWallWindowsPerBlock(count),
        };
    });
    return buildRowMatches(WINDOWS_PICK_PREFIX, rows, query);
};

const sharedProps = ({ matches, activeIndex, setActiveIndex, executeMatch, isDaylight, theme, isExecuting }: Parameters<NonNullable<CommandPaletteSurface['mapProps']>>[0]) => ({
    matches,
    activeIndex,
    setActiveIndex,
    executeMatch,
    isDaylight,
    theme,
    isExecuting,
});

export const libraryWallLookPickerSurface: CommandPaletteSurface = {
    load: () => import('./LibraryWallPickerSurfaceView'),
    useLiveQuery: true,
    buildMatches: ({ context, query }) => buildLookMatches(context, query),
    mapProps: args => ({
        ...sharedProps(args),
        headerTitle: args.context.shared.t('commandPalette.commands.library-wall-look-picker.title', 'Pick wall transparency'),
        selectedValue: args.context.settings.libraryWallLook(),
        selectedLabel: libraryWallLookLabel(args.context.settings.libraryWallLook(), args.context.shared.t),
    }),
};

export const libraryWallWindowsPickerSurface: CommandPaletteSurface = {
    load: () => import('./LibraryWallPickerSurfaceView'),
    useLiveQuery: true,
    buildMatches: ({ context, query }) => buildWindowsMatches(context, query),
    mapProps: args => ({
        ...sharedProps(args),
        headerTitle: args.context.shared.t('commandPalette.commands.library-wall-windows-picker.title', 'Pick windows per block'),
        selectedValue: String(args.context.settings.libraryWallWindowsPerBlock()),
        selectedLabel: libraryWallWindowsLabel(args.context.settings.libraryWallWindowsPerBlock(), args.context.shared.t),
    }),
};

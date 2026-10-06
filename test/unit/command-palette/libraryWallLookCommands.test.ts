import { describe, expect, it, vi } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from '@/components/command-palette/commandRegistry';
import {
    libraryWallLookPickerSurface,
    libraryWallWindowsPickerSurface,
    readLibraryWallPick,
} from '@/components/command-palette/surfaces/libraryWallLookSurface';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import type { LibraryWallLook } from '@/utils/libraryWallLook';

// test/unit/command-palette/libraryWallLookCommands.test.ts
// bravais 透光的两条命令（B6b②）：可用性与设置分区同一个谓词（context.settings.isLibraryWallLookAvailable，
// 生效 suite 是 bravais），窗数命令另要求档位是部分透明；两个 picker 的行、当前项标记、筛选与执行。

type Settings = {
    available: boolean;
    look: LibraryWallLook;
    windows: number;
};

const createContext = (state: Settings) => {
    const setLibraryWallLook = vi.fn((look: LibraryWallLook) => { state.look = look; });
    const setLibraryWallWindowsPerBlock = vi.fn((count: number) => { state.windows = count; });
    const context = {
        shared: { t: (_key: string, fallback?: string) => fallback ?? '' },
        settings: {
            isLibraryWallLookAvailable: () => state.available,
            libraryWallLook: () => state.look,
            setLibraryWallLook,
            libraryWallWindowsPerBlock: () => state.windows,
            setLibraryWallWindowsPerBlock,
        },
    } as unknown as CommandPaletteContext;
    return { context, setLibraryWallLook, setLibraryWallWindowsPerBlock };
};

const command = (id: string) => {
    const found = COMMAND_PALETTE_COMMANDS.find(candidate => candidate.id === id);
    if (!found) throw new Error(`missing command ${id}`);
    return found;
};

describe('library wall look commands', () => {
    it('are registered in the settings group behind a picker surface, with no execute shortcut', () => {
        for (const id of ['library-wall-look-picker', 'library-wall-windows-picker']) {
            const entry = command(id);
            expect(entry.group).toBe('settings');
            expect(entry.surface).toBeDefined();
            expect(entry.requiresInput).toBe(true);
            expect(entry.executeShortcut).toBeUndefined();
        }
    });

    it('offers the look picker only while bravais is the effective suite', () => {
        const look = command('library-wall-look-picker');
        for (const value of ['solid', 'partial', 'clear'] as const) {
            expect(look.isAvailable?.(createContext({ available: true, look: value, windows: 3 }).context)).toBe(true);
            expect(look.isAvailable?.(createContext({ available: false, look: value, windows: 3 }).context)).toBe(false);
        }
    });

    it('offers the windows picker only on bravais with the partial look', () => {
        const windows = command('library-wall-windows-picker');
        const available = (state: Settings) => windows.isAvailable?.(createContext(state).context);

        expect(available({ available: true, look: 'partial', windows: 3 })).toBe(true);
        expect(available({ available: true, look: 'solid', windows: 3 })).toBe(false);
        expect(available({ available: true, look: 'clear', windows: 3 })).toBe(false);
        expect(available({ available: false, look: 'partial', windows: 3 })).toBe(false);
    });

    it('stays listable without a context (contract checks, the all-commands list)', () => {
        expect(command('library-wall-look-picker').isAvailable?.()).toBe(true);
        expect(command('library-wall-windows-picker').isAvailable?.()).toBe(true);
    });
});

describe('library wall look picker', () => {
    it('lists the three looks in order and marks the current one', () => {
        const { context } = createContext({ available: true, look: 'clear', windows: 3 });
        const matches = libraryWallLookPickerSurface.buildMatches!({ context, query: '' });

        expect(matches.map(match => readLibraryWallPick(match.command.id))).toEqual(['solid', 'partial', 'clear']);
        expect(matches.every(match => match.command.textSource === 'runtime')).toBe(true);
        expect(matches[2].command.description).toBe('In use');
        expect(matches[0].command.description).not.toBe('In use');
    });

    it('filters by label or id and applies the picked look', async () => {
        const { context, setLibraryWallLook } = createContext({ available: true, look: 'partial', windows: 3 });
        const matches = libraryWallLookPickerSurface.buildMatches!({ context, query: 'solid' });

        expect(matches.map(match => readLibraryWallPick(match.command.id))).toEqual(['solid']);
        expect(await matches[0].command.execute('', context)).toBe(true);
        expect(setLibraryWallLook).toHaveBeenCalledWith('solid');
    });
});

describe('library wall windows picker', () => {
    it('lists one to six windows with their share of a block and marks the current count', () => {
        const { context } = createContext({ available: true, look: 'partial', windows: 4 });
        const matches = libraryWallWindowsPickerSurface.buildMatches!({ context, query: '' });

        expect(matches.map(match => readLibraryWallPick(match.command.id))).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(matches[0].command.description).toContain('8%');
        expect(matches[5].command.description).toContain('50%');
        expect(matches[3].command.description.startsWith('In use')).toBe(true);
        expect(matches[2].command.description.startsWith('In use')).toBe(false);
    });

    it('finds a count by its number or its percentage and applies it', async () => {
        const { context, setLibraryWallWindowsPerBlock } = createContext({ available: true, look: 'partial', windows: 3 });

        const byCount = libraryWallWindowsPickerSurface.buildMatches!({ context, query: '5' });
        expect(byCount.map(match => readLibraryWallPick(match.command.id))).toEqual(['5']);

        // 1–6 只认档位本身，不做子串匹配（「5」不会顺带命中 25% / 50%）。
        const byOne = libraryWallWindowsPickerSurface.buildMatches!({ context, query: '1' });
        expect(byOne.map(match => readLibraryWallPick(match.command.id))).toEqual(['1']);

        const byShare = libraryWallWindowsPickerSurface.buildMatches!({ context, query: '33%' });
        expect(byShare.map(match => readLibraryWallPick(match.command.id))).toEqual(['4']);
        const byBareShare = libraryWallWindowsPickerSurface.buildMatches!({ context, query: '50' });
        expect(byBareShare.map(match => readLibraryWallPick(match.command.id))).toEqual(['6']);

        expect(await byShare[0].command.execute('', context)).toBe(true);
        expect(setLibraryWallWindowsPerBlock).toHaveBeenCalledWith(4);
    });
});

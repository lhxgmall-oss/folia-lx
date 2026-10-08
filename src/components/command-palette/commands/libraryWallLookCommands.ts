import { Blinds, GalleryVerticalEnd, Grid2x2 } from 'lucide-react';
import type { CommandPaletteCommand, CommandPaletteContext } from '../types';
import { createSettingsAnchorCommand, createToggleCommand, defineCommand } from '../commandFactories';
import { libraryWallLookPickerSurface, libraryWallWindowsPickerSurface } from '../surfaces/libraryWallLookSurface';

// src/components/command-palette/commands/libraryWallLookCommands.ts
// bravais 独有设置的命令（settings 组）：透光档位 picker、每块窗数 picker、集合叠页边开关，以及跳到界面设置
// 「Bravais 墙面」分组的锚点命令（settings-bravais）。
// 可用性与设置分区（LibraryWallLookSettings）同一个谓词：生效 suite 是 bravais（isBravaisLibraryActive，经 context 透出，
// 这里不 import registry）；窗数命令另要求当前档位是部分透明——别的档位没有「窗数」可调，设置分区里也不显示那一行。
// 没有执行键：两个 picker 要进 picker 选值；叠页边开关与锚点命令也不给（没有现成的前缀空间，打开面板搜得到即可）。
// B6 起透光另由 bravais 的 manifest 声明成外观动作（suite-chrome），那是另一组命令 id。

/** 档位命令的可用性：生效 suite 是 bravais。无 context（契约测试、全部命令列表）时视为可用。 */
export const isLibraryWallLookCommandAvailable = (context?: CommandPaletteContext): boolean => (
    context ? context.settings.isLibraryWallLookAvailable() : true
);

/** 窗数命令的可用性：bravais 生效，且档位是部分透明。 */
export const isLibraryWallWindowsCommandAvailable = (context?: CommandPaletteContext): boolean => (
    context
        ? context.settings.isLibraryWallLookAvailable() && context.settings.libraryWallLook() === 'partial'
        : true
);

export const libraryWallLookCommands: CommandPaletteCommand[] = [
    defineCommand({
        id: 'library-wall-look-picker',
        group: 'settings',
        title: 'Pick wall transparency',
        description: 'Choose how much of the visualizer shows through the library wall',
        keywords: ['transparency', 'see through', 'wall look', 'bravais', '透光', '透明', '实色', '部分透明', '全透明'],
        icon: Blinds,
        isAvailable: isLibraryWallLookCommandAvailable,
        requiresInput: true,
        surface: libraryWallLookPickerSurface,
        placeholder: context => context.shared.t('commandPalette.pickerFilterPlaceholder', 'Type to filter, then click or press Enter'),
        execute: () => false,
    }),
    defineCommand({
        id: 'library-wall-windows-picker',
        group: 'settings',
        title: 'Pick windows per block',
        description: 'Choose how many tiles in each wall block are windows',
        keywords: ['window count', 'wall windows', 'transparency level', 'bravais', '窗数', '透光比例', '窗口数量'],
        icon: Grid2x2,
        isAvailable: isLibraryWallWindowsCommandAvailable,
        requiresInput: true,
        surface: libraryWallWindowsPickerSurface,
        placeholder: context => context.shared.t('commandPalette.pickerFilterPlaceholder', 'Type to filter, then click or press Enter'),
        execute: () => false,
    }),
    createToggleCommand(
        'library-wall-stack-edges-toggle',
        'settings',
        'Collection stack edges',
        'Show or hide the page edges on album, playlist and folder tiles',
        ['stack edges', 'page edges', 'collection tiles', 'bravais', '叠页边', '集合磁贴', '页边'],
        context => context.settings.toggleLibraryWallStackEdges(),
        { icon: GalleryVerticalEnd, isAvailable: isLibraryWallLookCommandAvailable },
    ),
    createSettingsAnchorCommand(
        'settings-bravais',
        'Bravais wall settings',
        'Jump to the settings that only apply to the Bravais wall',
        ['bravais settings', 'wall settings', 'bravais', 'Bravais 墙面', '墙面分组'],
        'bravaisSettings',
        { isAvailable: isLibraryWallLookCommandAvailable },
    ),
];

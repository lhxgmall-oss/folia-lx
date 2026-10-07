import { describe, expect, it } from 'vitest';
import bravais from '@/library/suites/bravais/entry';
import { BRAVAIS_HELP_ROWS } from '@/library/suites/bravais/bravaisHelp';
import { resolveBravaisKey, type BravaisKeyInput } from '@/library/suites/bravais/bravaisKeyboardModel';
import { resolveBravaisHomeKey } from '@/library/suites/bravais/bravaisHomeKeys';
import { COMMAND_PALETTE_COMMANDS } from '@/components/command-palette/commandRegistry';
import en from '@/i18n/locales/en';
import zhCN from '@/i18n/locales/zh-CN';
import id from '@/i18n/locales/in';

// test/unit/library/bravais/bravaisHelp.test.ts
// 工具面板「操作提示」的行与实际键位一致：墙上的键过一遍 bravaisKeyboardModel / bravaisHomeKeys 的规则，
// 「定位正在播放」核对执行模式的 `:` 与外观动作的执行键，三种语言都有每行的文案。

const press = (input: Partial<BravaisKeyInput> & { key: string }): BravaisKeyInput => ({
    shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, ...input,
});

const lookup = (locale: Record<string, unknown>, path: string) => path.split('.')
    .reduce<unknown>((node, segment) => (node as Record<string, unknown> | undefined)?.[segment], locale);

describe('bravais help rows', () => {
    it('lists one key per line, in order', () => {
        expect(BRAVAIS_HELP_ROWS.map(row => [row.id, row.kbd('Ctrl')])).toEqual([
            ['move', '↑ ↓ ← →'],
            ['open', 'Enter'],
            ['play', 'Enter'],
            ['enqueue', 'Shift + Enter'],
            ['back', 'ESC'],
            ['seam', 'Tab'],
            ['tabs', 'F6'],
            ['locate', ': + C'],
            ['commands', 'Ctrl + K'],
        ]);
    });

    it('names keys the wall actually handles', () => {
        for (const row of BRAVAIS_HELP_ROWS) {
            if (!row.probe) continue;
            const input = press(row.probe.input);
            const action = resolveBravaisKey(input) ?? resolveBravaisHomeKey(input);
            expect(action?.type, row.id).toBe(row.probe.action);
        }
    });

    it('locates the playing song through execute mode and the chrome action key', () => {
        expect(COMMAND_PALETTE_COMMANDS.find(command => command.id === 'execute-mode')?.openHotkey).toEqual({ key: ':' });
        expect(bravais.chromeActions?.find(action => action.id === 'locate-playing')?.executeShortcut).toBe('c');
    });

    it('has a label for every row in each locale', () => {
        for (const locale of [en, zhCN, id]) {
            for (const row of BRAVAIS_HELP_ROWS) {
                expect(typeof lookup(locale as Record<string, unknown>, row.labelKey), row.labelKey).toBe('string');
            }
        }
    });
});

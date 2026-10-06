import { describe, expect, it } from 'vitest';
import type { LibraryNavigationCrumb } from '@/library/core/contracts/suite';
import { buildBravaisCrumbs, type BravaisCrumbsInput } from '@/library/suites/bravais/bravaisCrumbs';

// test/unit/library/bravais/bravaisNavigationTransitions.test.ts
// B11 导航与转场收尾的纯规则：
// - 面包屑：根 / 中间层给 onPopTo 的 depth（按位置，栈有重复项时点哪一项退哪一层），中间层多于 1 层时折成「…」，
//   展开后全部可点；面板开着时当前层可点（关面板）；trail 对不上正在画的层时退回不可点的「…」。

const crumb = (key: string, name = key): LibraryNavigationCrumb => ({ key, name, type: 'album' });

const input = (overrides: Partial<BravaisCrumbsInput>): BravaisCrumbsInput => ({
    rootLabel: 'Library',
    depth: 1,
    trail: [crumb('a', 'A')],
    layerKey: 'a',
    currentLabel: 'A now',
    expanded: false,
    ...overrides,
});

describe('bravais breadcrumbs', () => {
    it('a root collection: the root jumps to depth 0, the current layer is plain text', () => {
        expect(buildBravaisCrumbs(input({}))).toEqual([
            { kind: 'root', label: 'Library', depth: 0 },
            { kind: 'current', label: 'A now', closesPanel: false },
        ]);
    });

    it('one middle layer stays visible and jumps to its position', () => {
        expect(buildBravaisCrumbs(input({ depth: 2, trail: [crumb('a', 'A'), crumb('b', 'B')], layerKey: 'b', currentLabel: 'B' }))).toEqual([
            { kind: 'root', label: 'Library', depth: 0 },
            { kind: 'layer', label: 'A', depth: 1 },
            { kind: 'current', label: 'B', closesPanel: false },
        ]);
    });

    it('folds all but the nearest middle layer, and the expanded trail lists every position (duplicates included)', () => {
        const trail = [crumb('a', 'A'), crumb('b', 'B'), crumb('a', 'A'), crumb('c', 'C')];
        const folded = buildBravaisCrumbs(input({ depth: 4, trail, layerKey: 'c', currentLabel: 'C' }));
        expect(folded).toEqual([
            { kind: 'root', label: 'Library', depth: 0 },
            { kind: 'more', hidden: [{ label: 'A', depth: 1 }, { label: 'B', depth: 2 }] },
            { kind: 'layer', label: 'A', depth: 3 },
            { kind: 'current', label: 'C', closesPanel: false },
        ]);
        const expanded = buildBravaisCrumbs(input({ depth: 4, trail, layerKey: 'c', currentLabel: 'C', expanded: true }));
        expect(expanded.filter(item => item.kind === 'layer')).toEqual([
            { kind: 'layer', label: 'A', depth: 1 },
            { kind: 'layer', label: 'B', depth: 2 },
            { kind: 'layer', label: 'A', depth: 3 },
        ]);
        expect(expanded.some(item => item.kind === 'more')).toBe(false);
    });

    it('with a panel open the current layer closes it and the panel is the last crumb', () => {
        const crumbs = buildBravaisCrumbs(input({ depth: 2, trail: [crumb('a'), crumb('b')], layerKey: 'b', currentLabel: 'B', panelLabel: 'List' }));
        expect(crumbs.slice(-2)).toEqual([
            { kind: 'current', label: 'B', closesPanel: true },
            { kind: 'panel', label: 'List' },
        ]);
    });

    it('falls back to a plain ellipsis when the trail does not describe the drawn layer (mid seam flip, no trail)', () => {
        const stale = buildBravaisCrumbs(input({ depth: 3, trail: [crumb('a'), crumb('b'), crumb('c')], layerKey: 'b', currentLabel: 'B' }));
        expect(stale).toEqual([
            { kind: 'root', label: 'Library', depth: 0 },
            { kind: 'more', hidden: [] },
            { kind: 'current', label: 'B', closesPanel: false },
        ]);
        expect(buildBravaisCrumbs(input({ depth: 1, trail: undefined }))).toHaveLength(2);
    });
});

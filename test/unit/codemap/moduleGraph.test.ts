import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildModuleGraph, edgeKey } from '../../../dev/mcp/ts-code-map/graph/modules.mjs';
import { scanModuleSpecifiers } from '../../../dev/mcp/ts-code-map/graph/specifiers.mjs';

// test/unit/codemap/moduleGraph.test.ts
// codemap 的模块图（dev/mcp/ts-code-map/graph）按词读 import / export：写成多行的语句也要进图，
// 注释、字符串、模板串里长得像 import 的文字不算。分层检查（codemap.mjs 的 BOUNDARY_RULES）只看这张图，
// 漏一条边就漏报一条违规。

const { fixtureFiles } = vi.hoisted(() => ({ fixtureFiles: [] as string[] }));
// 图的文件清单平时来自 git ls-files；临时目录不是仓库，直接给定。
vi.mock('../../../dev/mcp/ts-code-map/files.mjs', () => ({ listFiles: () => fixtureFiles }));

/** 说明符连同标记写成一行，方便整组比对。 */
const specifiersOf = (text: string, file = 'src/example.ts') => scanModuleSpecifiers(text, file)
    .map(({ specifier, typeOnly, dynamic }) => `${specifier}${typeOnly ? ' (type)' : ''}${dynamic ? ' (dynamic)' : ''}`);

const source = (...lines: string[]) => lines.join('\n');

describe('codemap module specifiers', () => {
    it('reads imports and re-exports that span several lines', () => {
        expect(specifiersOf(source(
            'import {',
            '    a,',
            '    b as c,',
            "} from './values';",
            'import type {',
            '    A,',
            "} from '@/types/shapes';",
            'export {',
            '    d,',
            "} from './reexported';",
            'export type {',
            '    B,',
            "} from './reexportedTypes';",
            'export * as ns',
            "    from './namespace';",
            'export {',
            '    // a comment with ; inside',
            '    e,',
            "} from './commented';",
        ))).toEqual([
            './values',
            '@/types/shapes (type)',
            './reexported',
            './reexportedTypes (type)',
            './namespace',
            './commented',
        ]);
    });

    it('keeps reading the single-line forms the same way', () => {
        expect(specifiersOf(source(
            "import React, { useState } from 'react';",
            "import * as all from './all';",
            "import type { Shape } from './shape';",
            "import type from './typeIsTheDefaultName';",
            "export * from './everything';",
            "export type * from './everyType';",
            "export { default as Thing } from './thing';",
            "const lazy = () => import('./lazy');",
        ))).toEqual([
            'react',
            './all',
            './shape (type)',
            './typeIsTheDefaultName',
            './everything',
            './everyType (type)',
            './thing',
            './lazy (dynamic)',
        ]);
    });

    it('ignores import-like text in comments, strings, templates and properties', () => {
        expect(specifiersOf(source(
            "// import a from './lineComment';",
            "/* import b from './blockComment'; */",
            "/** @type {import('./jsdoc').T} */",
            'const quoted = "import c from \'./quoted\'";',
            'const generated = `',
            "import d from './templated';",
            '`;',
            'const keys = { import: 1, export: 2 };',
            "loader.import('./method');",
            "const computed = import('./prefix/' + name);",
            'export { local };',
            'export type Local = string;',
        ))).toEqual([]);
    });

    it('does not lose the imports after a regex, nested templates or a stray #', () => {
        expect(specifiersOf(source(
            "const trimSlashes = (text: string) => text.replace(/\\/*$/, '');",
            "import { afterRegex } from './afterRegex';",
            "const nested = `${flag ? `${inner}` : '}'}${'`'}`;",
            "import { afterTemplate } from './afterTemplate';",
            'const badge = <span>#1</span>;',
            "import { afterHash } from './afterHash';",
        ), 'src/Example.tsx')).toEqual(['./afterRegex', './afterTemplate', './afterHash']);
    });

    it('reads past escaped quotes, regex character classes, private names and CRLF line ends', () => {
        // 每一处读错都会把后面的反引号当成模板串的开头，一路吞到文件尾
        expect(specifiersOf(source(
            "const quote = 'it\\'s `'; const double = \"say \\\"hi\\\"\";",
            "import { afterEscapes } from './afterEscapes';",
            'const hasTick = /[/`]/.test(text);',
            "import { afterClass } from './afterClass';",
            "class Loader { #import = 1; read() { return this.#import('./private'); } }",
            "import {\r\n    afterCrlf,\r\n} from './afterCrlf';",
        ))).toEqual(['./afterEscapes', './afterClass', './afterCrlf']);
    });

    it('stops an export list at its brace when the next statement starts without a semicolon', () => {
        expect(specifiersOf(source(
            'export { a }',
            "import type { B } from './next'",
        ))).toEqual(['./next (type)']);
    });
});

describe('codemap module graph', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'codemap-graph-'));
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    const files: Record<string, string> = {
        'src/services/themePreferences.ts': 'export const preferDark = true;\n',
        'src/types/visualizerModes.ts': 'export type VisualizerMode = string;\n',
        'src/utils/appearancePlan.ts': source(
            'import {',
            '    preferDark,',
            "} from '../services/themePreferences';",
            'export const plan = preferDark;',
        ),
        'src/services/visualizerPersistence.ts': source(
            'import type {',
            '    VisualizerMode,',
            "} from '@/types/visualizerModes';",
            'export const modes: VisualizerMode[] = [];',
        ),
        'src/components/Panel.tsx': source(
            'import {',
            '    useState,',
            "} from 'react';",
            'export const Panel = () => useState(0);',
        ),
    };
    for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
    }
    fixtureFiles.push(...Object.keys(files));

    it('puts multi-line imports into the graph with their type-only and UI marks', () => {
        const graph = buildModuleGraph(root);

        expect([...graph.forward.get('src/utils/appearancePlan.ts') ?? []]).toEqual(['src/services/themePreferences.ts']);
        expect(graph.typeOnly.has(edgeKey('src/utils/appearancePlan.ts', 'src/services/themePreferences.ts'))).toBe(false);

        expect([...graph.forward.get('src/services/visualizerPersistence.ts') ?? []]).toEqual(['src/types/visualizerModes.ts']);
        expect(graph.typeOnly.has(edgeKey('src/services/visualizerPersistence.ts', 'src/types/visualizerModes.ts'))).toBe(true);

        expect([...graph.uiSeeds]).toEqual(['src/components/Panel.tsx']);
    });
});

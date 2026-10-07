import { describe, expect, it } from 'vitest';
import { resolveReflowReturn, type BravaisReflowMap } from '@/library/suites/bravais/useBravaisReflowReturn';

// test/unit/library/bravais/bravaisReflowReturn.test.ts
// fb2：聚焦卡收起 / 换块时，离开让位表的 slot 在过渡时长内仍算「正在归位」（磁贴照样挂 is-reflowing，CSS 过渡才会起）。

const rect = { x: 0, y: 0, width: 10, height: 10 };
const block = (column: number, keys: readonly number[]): BravaisReflowMap => new Map(keys.map(index => [`${column},0,${index}`, rect]));
const EMPTY: BravaisReflowMap = new Map();
const idle = (reflow: BravaisReflowMap) => ({ reflow, returning: EMPTY, returningBlock: EMPTY });

describe('resolveReflowReturn', () => {
    it('collapsing hands the whole block over to the returning set', () => {
        const a = block(0, [0, 1, 2]);
        const next = resolveReflowReturn(idle(a), EMPTY);
        expect([...next.returning.keys()]).toEqual(['0,0,0', '0,0,1', '0,0,2']);
        expect([...next.returningBlock.keys()]).toEqual(['0,0,0', '0,0,1', '0,0,2']);
        expect(next.reflow).toBe(EMPTY);
    });

    it('switching to another block returns the old one while the new one opens', () => {
        const next = resolveReflowReturn(idle(block(0, [0, 1])), block(1, [0, 1]));
        expect([...next.returning.keys()]).toEqual(['0,0,0', '0,0,1']);
        expect([...next.returningBlock.keys()]).toEqual(['0,0,0', '0,0,1']);
    });

    it('another song in the same block is not a return', () => {
        const next = resolveReflowReturn(idle(block(0, [0, 1])), block(0, [0, 1]));
        expect(next.returning.size).toBe(0);
        expect(next.returningBlock.size).toBe(0);
    });

    it('keeps earlier returns until they finish, but re-expanding a returning block takes it back', () => {
        const first = resolveReflowReturn(idle(block(0, [0, 1])), block(1, [0]));
        const second = resolveReflowReturn(first, EMPTY);
        expect([...second.returning.keys()].sort()).toEqual(['0,0,0', '0,0,1', '1,0,0']);
        expect([...second.returningBlock.keys()]).toEqual(['1,0,0']);
        const third = resolveReflowReturn(second, block(0, [0, 1]));
        expect([...third.returning.keys()]).toEqual(['1,0,0']);
        expect(third.returningBlock.size).toBe(0);
    });
});

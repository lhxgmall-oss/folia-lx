import { useEffect, useState } from 'react';
import { BRAVAIS_REFLOW_MS } from './bravaisConstants';
import type { BravaisTileRect } from './BravaisTile';

// src/library/suites/bravais/useBravaisReflowReturn.ts
// 聚焦卡收起（或换到别的块）时，原来让位的那一块要沿同一条 CSS 过渡回到原位（设计稿 §7「旧卡收回、新卡展开，两个块
// 同时过渡」）。过渡挂在 .bravais-tile.is-reflowing 上：如果收起的那次提交里同时去掉这个类、换回原矩形，浏览器
// 不会起过渡，整块瞬间归位（fb2 之前的「硬切」）。所以离开让位表的 slot 在过渡时长内仍算「正在归位」，
// 磁贴照样挂 is-reflowing；时长过了再一次性摘掉（一次 setState）。
// 归位集合在渲染里按「上一次的让位表」推出（同一次提交里就有，不晚一帧）；最近一次离开的那一块单独给出，
// 透光档的块底板只逐帧跟它（useBravaisReflowPlate）。

export type BravaisReflowMap = ReadonlyMap<string, BravaisTileRect>;

const EMPTY: BravaisReflowMap = new Map();
/** 过渡时长之外多留一点：开始时间可能晚一两帧才定。 */
const RETURN_HOLD_MS = BRAVAIS_REFLOW_MS + 120;

type ReturnState = {
    /** 推出下面两项时的让位表。 */
    reflow: BravaisReflowMap;
    /** 所有还在归位的 slot（离开让位表、过渡还没放完）。 */
    returning: BravaisReflowMap;
    /** 最近一次离开让位表的那一块（块底板逐帧跟它）。 */
    returningBlock: BravaisReflowMap;
};

const withoutKeys = (source: BravaisReflowMap, keep: BravaisReflowMap): BravaisReflowMap => {
    const next = new Map([...source].filter(([key]) => !keep.has(key)));
    return next.size > 0 ? next : EMPTY;
};

/** 让位表从 previous 换成 next 时，哪些 slot 进入 / 仍在归位（纯函数）。 */
export const resolveReflowReturn = (previous: ReturnState, next: BravaisReflowMap): ReturnState => {
    const returningBlock = withoutKeys(previous.reflow, next);
    const returning = withoutKeys(new Map([...previous.returning, ...returningBlock]), next);
    return { reflow: next, returning, returningBlock };
};

export const useBravaisReflowReturn = (reflow: BravaisReflowMap) => {
    const [state, setState] = useState<ReturnState>(() => ({ reflow, returning: EMPTY, returningBlock: EMPTY }));
    let current = state;
    if (state.reflow !== reflow) {
        // 渲染期间按上一次渲染的值推导（React 支持的写法）：这次提交里归位的磁贴已经带着 is-reflowing。
        current = resolveReflowReturn(state, reflow);
        setState(current);
    }

    const { returning } = current;
    useEffect(() => {
        if (returning.size === 0) return undefined;
        const timer = window.setTimeout(() => {
            setState(latest => (latest.returning === returning ? { ...latest, returning: EMPTY, returningBlock: EMPTY } : latest));
        }, RETURN_HOLD_MS);
        return () => window.clearTimeout(timer);
    }, [returning]);

    return { returning: current.returning, returningBlock: current.returningBlock };
};

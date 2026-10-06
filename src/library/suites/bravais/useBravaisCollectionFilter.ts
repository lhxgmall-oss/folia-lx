import { useEffect, useRef, useState } from 'react';
import { useCommittedQuery } from '../../core/bindings/useCommittedQuery';
import { useLibrarySessionQuery } from '../../core/bindings/useLibrarySessionQuery';
import { useGridCommandFilter } from '../../../hooks/useGridCommandFilter';
import { bravaisFilterAnchorRef, useBravaisUiStore } from './bravaisUiStore';

// src/library/suites/bravais/useBravaisCollectionFilter.ts
// 集合页的过滤（设计稿 §7.6「Command palette 接入」）：过滤词在浏览会话里（换 suite 不丢），输入交给命令面板的内联过滤框——
// useGridCommandFilter({ port: 会话 query, anchorRef: 缝里的锚点, reopenIfFiltered: true })。框里按 ↓ 把键盘焦点交给墙上
// 的 rank 0（stage 注册的 focusFirst）。输入法组词期间不发查询：锚点上能听到框里输入框冒泡上来的 composition 事件，
// 组词时墙用的过滤词停在组词开始前的那一个，组完（compositionend）再提交，拼音字母不会把墙先过滤一遍。

/** 组词期间按住的过滤词（组词开始前的值）；不在组词就是传入的值。 */
const useCompositionHold = (query: string) => {
    const host = useBravaisUiStore(state => state.filterHost);
    const [isComposing, setIsComposing] = useState(false);
    const heldRef = useRef(query);
    if (!isComposing) heldRef.current = query;

    useEffect(() => {
        if (!host) return;
        const start = () => setIsComposing(true);
        const end = () => setIsComposing(false);
        host.addEventListener('compositionstart', start);
        host.addEventListener('compositionend', end);
        return () => {
            host.removeEventListener('compositionstart', start);
            host.removeEventListener('compositionend', end);
            setIsComposing(false);
        };
    }, [host]);

    return isComposing ? heldRef.current : query;
};

export const useBravaisCollectionFilter = ({ sessionKey, isActive }: { sessionKey: string; isActive: boolean }) => {
    const { query, setQuery, port } = useLibrarySessionQuery(sessionKey);
    const isFiltering = useGridCommandFilter({
        isInteractive: isActive,
        port,
        anchorRef: bravaisFilterAnchorRef,
        reopenIfFiltered: true,
        onFocusResults: () => useBravaisUiStore.getState().focusFirst?.() ?? false,
    });
    const committedQuery = useCommittedQuery(useCompositionHold(query));
    return { query, setQuery, committedQuery, isFiltering };
};

import React, { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import type { BravaisLayer } from './bravaisLayer';
import { setBravaisSearchOpen } from './bravaisHomeUiStore';

// src/library/suites/bravais/BravaisSeamSearch.tsx
// 首页缝里的全局搜索框（设计稿 §10.5「全局搜索的过渡方案」）：⌕ 或 `/` 把首页窄缝临时展开成完整宽度，输入框拿焦点。
// 提交走宿主的 onSearchCommitted，跳到 SearchWorkspace——过渡期唯一的离墙路径（计划完成标准 5），提交后搜索框关上；
// 「关闭搜索」、Esc 只关框。输入框非受控：打字不经过层描述，只在提交时把词交给 surface。
// 这里不注册命令面板的过滤（首页不注册过滤，`s` 仍是打开命令面板）。

const BravaisSeamSearch: React.FC<{ layer: BravaisLayer }> = ({ layer }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const search = layer.seam.home?.search;
    useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, []);
    if (!search) return null;
    const close = () => setBravaisSearchOpen(false);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        const query = inputRef.current?.value.trim() ?? '';
        if (!query) return;
        search.onSubmit(query);
        close();
    };
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        close();
    };
    return (
        <div className="bravais-seam-search" data-bravais-search>
            <div className="bravais-seam-crumbs">
                <span className="bravais-seam-crumb-trail">
                    <span>{layer.seam.title}</span>
                    <i>›</i><span>{search.title}</span>
                </span>
                <button type="button" className="bravais-seam-level" data-bravais-seam-action="close-search" onClick={close}>
                    {search.closeLabel}
                </button>
            </div>
            <form className="bravais-search-form" role="search" onSubmit={submit}>
                <Search aria-hidden />
                <input
                    ref={inputRef}
                    name="bravais-search"
                    type="search"
                    placeholder={search.placeholder}
                    aria-label={search.title}
                    autoComplete="off"
                    spellCheck={false}
                    onKeyDown={onKeyDown}
                />
                <button type="button" className="bravais-seam-icon" aria-label={search.closeLabel} title={search.closeLabel} onClick={close}>
                    <X aria-hidden />
                </button>
            </form>
            <span className="bravais-form-buttons">
                <button type="button" className="bravais-chrome-button is-primary" data-bravais-seam-action="submit-search"
                    onClick={() => inputRef.current?.form?.requestSubmit()}>
                    <Search aria-hidden />{search.submitLabel}
                </button>
            </span>
        </div>
    );
};

export default BravaisSeamSearch;

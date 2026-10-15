// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/shared/customSelect.test.ts
// CustomSelect 为 Folium 表单（#485）加的行为：捕获阶段的外部点击（命令面板根节点会拦 mousedown）、
// 焦点移走即收起、Escape 只关菜单不惊动外层、↑↓/Enter 选择、键盘高亮跟随滚动（普通与虚拟化两个分支）、
// compact 尺寸与调用方接管的触发按钮外观、ariaLabelledBy 让触发按钮的名字带上当前值、i18n 占位文字。

vi.mock('react-i18next', async importOriginal => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CustomSelect } from '@/components/shared/CustomSelect';
import { stepCustomSelectIndex } from '@/components/shared/useCustomSelectNavigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
    { value: 'h264', label: 'H.264' },
    { value: 'hevc', label: 'HEVC' },
    { value: 'av1', label: 'AV1' },
];

let root: Root | null = null;
const windowListeners: Array<(event: KeyboardEvent) => void> = [];

/** jsdom 不实现元素滚动；用例按需装上替身，结束后还原。 */
const scrollStubs: Array<() => void> = [];

afterEach(() => {
    act(() => root?.unmount());
    root = null;
    windowListeners.splice(0).forEach(listener => window.removeEventListener('keydown', listener));
    scrollStubs.splice(0).forEach(restore => restore());
    document.body.replaceChildren();
});

const stubElementMethod = (name: 'scrollTo' | 'scrollIntoView', impl: (this: HTMLElement, ...args: unknown[]) => void) => {
    const spy = vi.fn(impl);
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, name);
    Object.defineProperty(Element.prototype, name, { configurable: true, writable: true, value: spy });
    scrollStubs.push(() => {
        if (descriptor) Object.defineProperty(Element.prototype, name, descriptor);
        else delete (Element.prototype as unknown as Record<string, unknown>)[name];
    });
    return spy;
};

type SelectProps = React.ComponentProps<typeof CustomSelect>;

/** 挂一个 CustomSelect；外层像命令面板那样在 mousedown 上 stopPropagation，旁边放一个可点的兄弟元素。 */
const renderSelect = (props: Partial<SelectProps> = {}) => {
    const onChange = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const render = (next: Partial<SelectProps> = {}) => act(() => root!.render(
        React.createElement(
            'div',
            { onMouseDown: (event: React.MouseEvent) => event.stopPropagation() },
            React.createElement('span', { 'data-testid': 'elsewhere' }, 'elsewhere'),
            React.createElement('span', { id: 'field-label' }, 'Video codec'),
            React.createElement('input', { 'data-testid': 'other-field', 'aria-label': 'Other field' }),
            React.createElement(CustomSelect, {
                value: 'hevc',
                options: OPTIONS,
                ariaLabel: 'Codec',
                onChange,
                ...props,
                ...next,
            }),
        ),
    ));
    render();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!;
    const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    return { host, trigger, options, onChange, render };
};

/** 外层（命令面板、设置弹窗）在 window 冒泡阶段听按键，这里用一个间谍顶替。 */
const listenLikeOuterLayer = () => {
    const spy = vi.fn();
    const listener = (event: KeyboardEvent) => spy(event.key);
    window.addEventListener('keydown', listener);
    windowListeners.push(listener);
    return spy;
};

const press = (target: Element, key: string) => act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
});

describe('CustomSelect', () => {
    it('shows the selected label, and the translated placeholder when the value is not an option', () => {
        const { trigger, render } = renderSelect();
        expect(trigger.textContent).toBe('HEVC');
        render({ value: 'vp9' });
        expect(trigger.textContent).toBe('ui.selectPlaceholder');
        render({ value: 'vp9', placeholder: 'Pick one' });
        expect(trigger.textContent).toBe('Pick one');
    });

    it('opens on click, reports the picked option and closes', () => {
        const { trigger, options, onChange } = renderSelect();
        act(() => trigger.click());
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Codec');
        expect(options().map(option => option.textContent)).toEqual(['H.264', 'HEVC', 'AV1']);
        expect(options()[1].getAttribute('aria-selected')).toBe('true');

        act(() => options()[2].click());
        expect(onChange).toHaveBeenCalledWith('av1');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('stays shut while disabled, by pointer and by keyboard', () => {
        const { trigger, onChange } = renderSelect({ disabled: true });
        expect(trigger.disabled).toBe(true);
        act(() => trigger.click());
        press(trigger, 'ArrowDown');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('closes on a press elsewhere even inside a container that stops mousedown from bubbling', () => {
        const { host, trigger } = renderSelect();
        act(() => trigger.click());
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        // 菜单自己身上的按下不算外部。
        act(() => {
            document.querySelector('[role="listbox"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        act(() => {
            host.querySelector('[data-testid="elsewhere"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes when focus moves outside, so a later Enter belongs to the new focus', () => {
        const outer = listenLikeOuterLayer();
        const { host, trigger, onChange } = renderSelect();
        act(() => trigger.click());
        const other = host.querySelector<HTMLInputElement>('[data-testid="other-field"]')!;
        act(() => other.focus());
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        press(other, 'Enter');
        expect(onChange).not.toHaveBeenCalled();
        expect(outer).toHaveBeenCalledWith('Enter');
    });

    it('lets Escape close only the menu, then hands Escape back to the outer layer', () => {
        const outer = listenLikeOuterLayer();
        const { trigger } = renderSelect();
        act(() => trigger.click());

        press(trigger, 'Escape');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(outer).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(trigger);

        press(trigger, 'Escape');
        expect(outer).toHaveBeenCalledWith('Escape');
    });

    it('opens with the arrow keys, walks the options and picks with Enter without the outer layer seeing it', () => {
        const outer = listenLikeOuterLayer();
        const { trigger, options, onChange } = renderSelect();
        trigger.focus();

        press(trigger, 'ArrowDown');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        // 打开时高亮当前选中项。
        expect(options()[1].getAttribute('data-active')).toBe('true');

        press(trigger, 'ArrowDown');
        expect(options()[2].getAttribute('data-active')).toBe('true');
        press(trigger, 'ArrowDown');
        expect(options()[2].getAttribute('data-active')).toBe('true');
        press(trigger, 'Home');
        expect(options()[0].getAttribute('data-active')).toBe('true');

        press(trigger, 'Enter');
        expect(onChange).toHaveBeenCalledWith('h264');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(outer).not.toHaveBeenCalled();
    });

    it('follows the pointer and drops a pointer highlight when it leaves the menu', () => {
        const { trigger, options } = renderSelect();
        act(() => trigger.click());
        act(() => { options()[0].dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
        expect(options()[0].getAttribute('data-active')).toBe('true');

        act(() => {
            document.querySelector('[role="listbox"]')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
        });
        expect(options()[0].getAttribute('data-active')).toBeNull();
        expect(options()[1].getAttribute('data-active')).toBe('true');
    });

    it('scrolls the keyboard highlight into view in a short list, but not a pointer highlight', () => {
        const scrollIntoView = stubElementMethod('scrollIntoView', () => {});
        const { trigger, options } = renderSelect();
        trigger.focus();
        press(trigger, 'ArrowDown');
        expect(scrollIntoView).not.toHaveBeenCalled();

        press(trigger, 'ArrowDown');
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView.mock.contexts[0]).toBe(options()[2]);
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });

        act(() => { options()[0].dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
        expect(options()[0].getAttribute('data-active')).toBe('true');
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
    });

    it('walks a long (virtualized) list by keyboard: the highlight row is scrolled in and rendered active', () => {
        // react-window 的 scrollToRow 落到容器的 scrollTo；替身照真浏览器那样改 scrollTop 并发 scroll。
        const scrollTo = stubElementMethod('scrollTo', function (options) {
            this.scrollTop = (options as ScrollToOptions).top ?? this.scrollTop;
            this.dispatchEvent(new Event('scroll'));
        });
        const longOptions = Array.from({ length: 30 }, (_, index) => ({ value: `opt-${index}`, label: `Option ${index}` }));
        const outer = listenLikeOuterLayer();
        const { trigger, onChange } = renderSelect({ value: 'opt-0', options: longOptions });
        const row = (index: number) => document.querySelector<HTMLElement>(`[data-option-index="${index}"]`);
        trigger.focus();

        press(trigger, 'ArrowDown');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        // 虚拟化分支：起初只渲染视口加 overscan 的几行，第 12 行还不在 DOM 里。
        expect(row(0)?.getAttribute('data-active')).toBe('true');
        expect(row(12)).toBeNull();

        for (let step = 0; step < 12; step += 1) press(trigger, 'ArrowDown');
        // 菜单 maxHeight 240 减内边距 12 = 列表高 228；行高 40 + 间距 2。第 12 行底边贴到视口底边。
        expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 13 * 42 - 228 }));
        expect(row(12)?.getAttribute('data-active')).toBe('true');
        expect(document.querySelectorAll('[data-active="true"]')).toHaveLength(1);

        // 指针高亮不滚动。
        const scrollCalls = scrollTo.mock.calls.length;
        act(() => { row(10)!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
        expect(row(10)?.getAttribute('data-active')).toBe('true');
        expect(row(12)?.getAttribute('data-active')).toBeNull();
        expect(scrollTo.mock.calls.length).toBe(scrollCalls);

        press(trigger, 'End');
        expect(row(29)?.getAttribute('data-active')).toBe('true');
        press(trigger, 'Enter');
        expect(onChange).toHaveBeenCalledWith('opt-29');
        expect(outer).not.toHaveBeenCalled();
    });

    it('names the trigger by ariaLabelledBy plus its shown value, and the menu by ariaLabel', () => {
        const labelled = renderSelect({ ariaLabelledBy: 'field-label' });
        const ids = labelled.trigger.getAttribute('aria-labelledby')!.split(/\s+/);
        const name = () => ids.map(id => document.getElementById(id)?.textContent).join(' ');
        expect(ids[0]).toBe('field-label');
        expect(name()).toBe('Video codec HEVC');
        expect(labelled.trigger.hasAttribute('aria-label')).toBe(false);
        act(() => labelled.trigger.click());
        expect(document.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Codec');
        act(() => labelled.options()[0].click());
        expect(labelled.onChange).toHaveBeenCalledWith('h264');
        labelled.render({ value: 'h264' });
        expect(name()).toBe('Video codec H.264');
        act(() => root!.unmount());
        root = null;
        document.body.replaceChildren();

        // 没有 ariaLabel 时列表也由同一组 id 命名。
        const unnamedMenu = renderSelect({ ariaLabel: undefined, ariaLabelledBy: 'field-label' });
        act(() => unnamedMenu.trigger.click());
        const listbox = document.querySelector('[role="listbox"]')!;
        expect(listbox.hasAttribute('aria-label')).toBe(false);
        expect(listbox.getAttribute('aria-labelledby')).toBe('field-label');
        act(() => root!.unmount());
        root = null;
        document.body.replaceChildren();

        // 不传 ariaLabelledBy：标记与原来一致，按钮只有 aria-label，显示值的 span 不带 id。
        const plain = renderSelect();
        expect(plain.trigger.getAttribute('aria-label')).toBe('Codec');
        expect(plain.trigger.hasAttribute('aria-labelledby')).toBe(false);
        expect(plain.trigger.querySelector('span')?.hasAttribute('id')).toBe(false);
    });

    it('keeps the settings-page trigger by default and hands the surface to the caller when asked', () => {
        const plain = renderSelect();
        expect(plain.trigger.className).toContain('px-4 py-3 text-sm');
        expect(plain.trigger.style.backgroundColor).toBe('var(--overlay-medium)');
        act(() => root!.unmount());
        root = null;
        document.body.replaceChildren();

        const compact = renderSelect({
            size: 'compact',
            triggerClassName: 'field-class',
            triggerStyle: { border: '1px solid red' },
        });
        expect(compact.trigger.className).toContain('px-2.5 py-1.5 text-xs');
        expect(compact.trigger.className).toContain('field-class');
        expect(compact.trigger.style.backgroundColor).toBe('');
        expect(compact.trigger.style.border).toBe('1px solid red');
        act(() => compact.trigger.click());
        expect(compact.trigger.style.boxShadow).toContain('0 0 0 1px');
    });
});

describe('stepCustomSelectIndex', () => {
    it('starts from the ends without a highlight and clamps instead of wrapping', () => {
        expect(stepCustomSelectIndex(-1, 1, 3)).toBe(0);
        expect(stepCustomSelectIndex(-1, -1, 3)).toBe(2);
        expect(stepCustomSelectIndex(2, 1, 3)).toBe(2);
        expect(stepCustomSelectIndex(0, -1, 3)).toBe(0);
        expect(stepCustomSelectIndex(1, 1, 3)).toBe(2);
        expect(stepCustomSelectIndex(5, 1, 3)).toBe(0);
        expect(stepCustomSelectIndex(0, 1, 0)).toBe(-1);
    });
});

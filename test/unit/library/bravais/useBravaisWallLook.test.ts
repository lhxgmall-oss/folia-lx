// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryWallLookStore } from '@/stores/useLibraryWallLookStore';
import { useBravaisWallLook } from '@/library/suites/bravais/useBravaisWallLook';

// test/unit/library/bravais/useBravaisWallLook.test.ts
// bravais stage 的遮挡上报（B6b③）：实色档报 true（宿主据此在首页完全显示后卸载 visualizer），部分透明 / 全透明报
// false；档位变了重新报，换窗数或无关的重渲染不重复报。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let report: ReturnType<typeof vi.fn<(occludes: boolean) => void>>;

const Probe = ({ tick }: { tick: number }) => {
    useBravaisWallLook(report);
    return createElement('span', null, tick);
};

const render = (tick = 0) => {
    act(() => root.render(createElement(Probe, { tick })));
};

beforeEach(() => {
    report = vi.fn<(occludes: boolean) => void>();
    useLibraryWallLookStore.setState({ look: 'partial', windowsPerBlock: 3 });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('useBravaisWallLook', () => {
    it('reports no occlusion while any part of the wall lets the player through', () => {
        render();
        expect(report.mock.calls).toEqual([[false]]);
        act(() => useLibraryWallLookStore.setState({ look: 'clear' }));
        expect(report.mock.calls).toEqual([[false], [false]]);
    });

    it('reports occlusion on the solid look and drops it when the look turns see-through again', () => {
        useLibraryWallLookStore.setState({ look: 'solid' });
        render();
        expect(report).toHaveBeenLastCalledWith(true);
        act(() => useLibraryWallLookStore.setState({ look: 'partial' }));
        expect(report).toHaveBeenLastCalledWith(false);
        act(() => useLibraryWallLookStore.setState({ look: 'solid' }));
        expect(report).toHaveBeenLastCalledWith(true);
    });

    it('does not report again for a window count change or an unrelated render', () => {
        render(0);
        const calls = report.mock.calls.length;
        act(() => useLibraryWallLookStore.setState({ windowsPerBlock: 5 }));
        render(1);
        expect(report.mock.calls.length).toBe(calls);
    });
});

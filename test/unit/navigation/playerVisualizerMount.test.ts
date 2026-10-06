import { describe, expect, it } from 'vitest';
import { buildHomeSurfacePresentation } from '../../../src/components/app/presentation/buildHomeSurfacePresentation';
import { shouldMountPlayerVisualizer } from '../../../src/components/app/presentation/playerVisualizerMount';

// test/unit/navigation/playerVisualizerMount.test.ts
// App 背景层 visualizer 的挂载条件：Lattice 的既有条件不变，再加「首页显示着 + stage 报遮挡 + 已稳定」时卸载（B6b）。

type Case = {
    currentView: string;
    isSettingsModalOpen?: boolean;
    isPanelOpen?: boolean;
    hasLatticeExited?: boolean;
    libraryOccludesPlayer: boolean;
    hasLibraryOcclusionSettled: boolean;
};

/** 走 App 的真实组装：shouldShowHomeSurface 来自 buildHomeSurfacePresentation。 */
const mounts = ({
    currentView,
    isSettingsModalOpen = false,
    isPanelOpen = false,
    hasLatticeExited = true,
    libraryOccludesPlayer,
    hasLibraryOcclusionSettled,
}: Case) => {
    const { shouldShowHomeSurface } = buildHomeSurfacePresentation({ currentView, isSettingsModalOpen, isPanelOpen });
    return shouldMountPlayerVisualizer({
        currentView,
        hasLatticeExited,
        shouldShowHomeSurface,
        libraryOccludesPlayer,
        hasLibraryOcclusionSettled,
    });
};

describe('shouldMountPlayerVisualizer', () => {
    it('unmounts only on an unobstructed home whose stage occludes the player and has settled', () => {
        expect(mounts({ currentView: 'home', libraryOccludesPlayer: true, hasLibraryOcclusionSettled: true })).toBe(false);
    });

    it('keeps the visualizer mounted until the occlusion settles (home still fading in)', () => {
        expect(mounts({ currentView: 'home', libraryOccludesPlayer: true, hasLibraryOcclusionSettled: false })).toBe(true);
    });

    it('keeps the visualizer mounted when the stage does not occlude (grid, TUI, translucent looks)', () => {
        for (const hasLibraryOcclusionSettled of [false, true]) {
            for (const currentView of ['home', 'player', 'search']) {
                expect(mounts({ currentView, libraryOccludesPlayer: false, hasLibraryOcclusionSettled })).toBe(true);
            }
        }
    });

    it('remounts as soon as home stops showing: player view, settings dialog or panel over home', () => {
        const occluded = { libraryOccludesPlayer: true, hasLibraryOcclusionSettled: true };
        expect(mounts({ currentView: 'player', ...occluded })).toBe(true);
        expect(mounts({ currentView: 'home', isSettingsModalOpen: true, ...occluded })).toBe(true);
        expect(mounts({ currentView: 'home', isPanelOpen: true, ...occluded })).toBe(true);
    });

    it('keeps the Lattice rule unchanged whatever the library reports', () => {
        for (const libraryOccludesPlayer of [false, true]) {
            for (const hasLibraryOcclusionSettled of [false, true]) {
                const library = { libraryOccludesPlayer, hasLibraryOcclusionSettled };
                expect(mounts({ currentView: 'lattice', hasLatticeExited: false, ...library })).toBe(false);
                // 刚离开 Lattice、退出动画还没结束。
                expect(mounts({ currentView: 'player', hasLatticeExited: false, ...library })).toBe(false);
                expect(mounts({ currentView: 'home', hasLatticeExited: false, ...library })).toBe(false);
            }
        }
        expect(mounts({ currentView: 'player', libraryOccludesPlayer: false, hasLibraryOcclusionSettled: false })).toBe(true);
    });

    it('matches the previous condition whenever no stage occludes', () => {
        for (const currentView of ['home', 'player', 'lattice', 'search']) {
            for (const hasLatticeExited of [false, true]) {
                for (const isSettingsModalOpen of [false, true]) {
                    expect(mounts({
                        currentView,
                        hasLatticeExited,
                        isSettingsModalOpen,
                        libraryOccludesPlayer: false,
                        hasLibraryOcclusionSettled: false,
                    })).toBe(currentView !== 'lattice' && hasLatticeExited);
                }
            }
        }
    });
});

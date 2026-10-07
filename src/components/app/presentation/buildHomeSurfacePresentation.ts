// src/components/app/presentation/buildHomeSurfacePresentation.ts

type BuildHomeSurfacePresentationInput = {
    currentView: string;
    isSettingsModalOpen: boolean;
    isPanelOpen: boolean;
    /** 翻牌交接进 Lattice 期间（wallHandoffPresentation.keepsHome）：首页层留着、保持显示，Lattice 叠在上面落下来。 */
    keepsHomeForHandoff?: boolean;
};

// Derives independent mount and visibility state for the Home surface.
export const buildHomeSurfacePresentation = ({
    currentView,
    isSettingsModalOpen,
    isPanelOpen,
    keepsHomeForHandoff = false,
}: BuildHomeSurfacePresentationInput) => {
    // Overlays may hide Home while it is active, but must not remount it from the player view.
    const shouldKeepHomeMounted = currentView === 'home' || keepsHomeForHandoff;
    const shouldShowHomeSurface = currentView === 'home' && !isSettingsModalOpen && !isPanelOpen;
    // 显示（visibility / 整层 opacity）比可交互多一种情况：交接进 Lattice 时首页墙还看得见，但不再接输入。
    const shouldRevealHomeSurface = shouldShowHomeSurface || keepsHomeForHandoff;

    return {
        shouldKeepHomeMounted,
        shouldShowHomeSurface,
        shouldRevealHomeSurface,
    };
};

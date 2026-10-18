import { motionValue, type MotionValue } from 'framer-motion';

// src/stores/safeAreaInsets.ts
// The device's safe-area insets (status bar, navigation / gesture bar, display cutout) in CSS px, as
// MotionValues for the components whose position is already a MotionValue (the bottom baseline).
//
// The source of truth is CSS: --lx-safe-* in src/index.css, the larger of env(safe-area-inset-*) and
// the --safe-area-inset-* custom properties the Folia LX Android shell injects (MainActivity, which
// draws the WebView edge to edge and reports the bar sizes on every WebView version). A hidden probe
// element resolves them to numbers. On desktop and in ordinary browsers they are all 0, so nothing
// that adds them moves.

export type SafeAreaInsetSignals = {
    top: MotionValue<number>;
    right: MotionValue<number>;
    bottom: MotionValue<number>;
    left: MotionValue<number>;
};

export const safeAreaInsets: SafeAreaInsetSignals = {
    top: motionValue(0),
    right: motionValue(0),
    bottom: motionValue(0),
    left: motionValue(0),
};

let probe: HTMLDivElement | null = null;
let started = false;

const px = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const readSafeAreaInsets = (): void => {
    if (typeof document === 'undefined' || !document.body) {
        return;
    }
    if (!probe || !probe.isConnected) {
        probe = document.createElement('div');
        probe.setAttribute('aria-hidden', 'true');
        probe.dataset.foliaSafeAreaProbe = '';
        probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
            + 'padding:var(--lx-safe-top,0px) var(--lx-safe-right,0px) var(--lx-safe-bottom,0px) var(--lx-safe-left,0px);';
        document.body.appendChild(probe);
    }
    const style = getComputedStyle(probe);
    safeAreaInsets.top.set(px(style.paddingTop));
    safeAreaInsets.right.set(px(style.paddingRight));
    safeAreaInsets.bottom.set(px(style.paddingBottom));
    safeAreaInsets.left.set(px(style.paddingLeft));
};

/** Starts tracking (idempotent). Called by the hooks that read the signals. */
export const startSafeAreaInsetTracking = (): void => {
    if (started || typeof window === 'undefined') {
        return;
    }
    started = true;
    const update = () => readSafeAreaInsets();
    if (document.body) {
        update();
    } else {
        window.addEventListener('DOMContentLoaded', update, { once: true });
    }
    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('orientationchange', update, { passive: true });
    // Fired by the Android shell right after it sets the custom properties.
    window.addEventListener('folia-safe-area', update);
};

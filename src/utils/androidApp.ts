// src/utils/androidApp.ts
// Whether this page is the Folia LX Android app (the Capacitor shell under android/). The Android build
// sets VITE_FOLIA_TARGET=android (npm run build:android); at runtime the Capacitor bridge says so too.

type CapacitorGlobal = { getPlatform?: () => string; isNativePlatform?: () => boolean };

/** Built for the Android app: decided at build time, so module-level choices can rest on it. */
export const IS_ANDROID_BUILD: boolean = import.meta.env.VITE_FOLIA_TARGET === 'android';

/** Running inside the Android app (Capacitor's native bridge is present). */
export const isAndroidApp = (): boolean => {
    if (IS_ANDROID_BUILD) return true;
    if (typeof window === 'undefined') return false;
    const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    return capacitor?.getPlatform?.() === 'android';
};

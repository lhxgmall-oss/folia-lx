import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderErrorCode } from '../../../types/onlineMusic';
import { isAndroidApp } from '../../../utils/androidApp';

// src/services/onlineMusic/lx/lxTransport.ts
// The only way to the LX bridge (electron/lx/lxApiBridge.cjs): on desktop window.electron.lxRequest (the
// main process); in the Android app the same bridge running in this WebView (android/lxAndroidBridge.ts,
// loaded on first use). Both answer the same { ok, data } / { ok: false, error }.

export type LxOperation =
    | 'state' | 'search' | 'songlist_hot' | 'songlist_detail' | 'songlist_search' | 'lyric' | 'pic' | 'music_url'
    | 'script_import_text' | 'script_import_url' | 'script_import_file' | 'script_remove' | 'script_activate' | 'settings_set'
    | 'mylists' | 'mylist_tracks' | 'mylist_import_file' | 'mylist_remove' | 'mylist_cover_status';

export type LxBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string } };

// What a request fails with where this page has no desktop bridge (the web build), and where the bridge
// itself failed (the main process threw). lxFailure.ts tells both apart by them.
export const LX_NEEDS_DESKTOP = 'LX Music requires the desktop app';
export const LX_BRIDGE_FAILED = 'LX desktop request failed';

const KNOWN_CODES: readonly ProviderErrorCode[] = ['unsupported', 'unavailable', 'not-playable', 'network', 'invalid-response'];

const hasDesktopBridge = () => typeof window !== 'undefined' && typeof window.electron?.lxRequest === 'function';

export const getLxTransportAvailability = () => (
    hasDesktopBridge() || isAndroidApp()
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

const sendToBridge = async (operation: LxOperation, params: Record<string, unknown>): Promise<LxBridgeResult> => {
    if (hasDesktopBridge()) return window.electron!.lxRequest(operation, params);
    const { requestAndroidLx } = await import('./android/lxAndroidBridge');
    return requestAndroidLx(operation, params);
};

export async function requestLx<T = unknown>(operation: LxOperation, params: Record<string, unknown> = {}): Promise<T> {
    if (!getLxTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', LX_NEEDS_DESKTOP, 'lx');
    }
    let result: LxBridgeResult;
    try { result = await sendToBridge(operation, params); }
    catch (error) { throw new OnlineProviderError('network', LX_BRIDGE_FAILED, 'lx', error); }
    if (!result.ok) {
        const code = (KNOWN_CODES as readonly string[]).includes(result.error.code) ? result.error.code as ProviderErrorCode : 'invalid-response';
        throw new OnlineProviderError(code, result.error.message, 'lx');
    }
    return result.data as T;
}

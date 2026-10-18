import { OnlineProviderError } from '../../../types/onlineMusic';
import type { ProviderErrorCode } from '../../../types/onlineMusic';

// src/services/onlineMusic/lx/lxTransport.ts
// The only way to the LX bridge in the main process (electron/lx/lxApiBridge.cjs): window.electron.lxRequest.

export type LxOperation =
    | 'state' | 'search' | 'songlist_hot' | 'songlist_detail' | 'songlist_search' | 'lyric' | 'pic' | 'music_url'
    | 'script_import_text' | 'script_import_url' | 'script_import_file' | 'script_remove' | 'script_activate' | 'settings_set';

export type LxBridgeResult =
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string } };

// What a request fails with where this page has no desktop bridge (the web build), and where the bridge
// itself failed (the main process threw). lxFailure.ts tells both apart by them.
export const LX_NEEDS_DESKTOP = 'LX Music requires the desktop app';
export const LX_BRIDGE_FAILED = 'LX desktop request failed';

const KNOWN_CODES: readonly ProviderErrorCode[] = ['unsupported', 'unavailable', 'not-playable', 'network', 'invalid-response'];

export const getLxTransportAvailability = () => (
    typeof window !== 'undefined' && typeof window.electron?.lxRequest === 'function'
        ? { configured: true } as const
        : { configured: false, reason: 'runtime-unavailable' } as const
);

export async function requestLx<T = unknown>(operation: LxOperation, params: Record<string, unknown> = {}): Promise<T> {
    if (!getLxTransportAvailability().configured) {
        throw new OnlineProviderError('unavailable', LX_NEEDS_DESKTOP, 'lx');
    }
    let result: LxBridgeResult;
    try { result = await window.electron!.lxRequest(operation, params); }
    catch (error) { throw new OnlineProviderError('network', LX_BRIDGE_FAILED, 'lx', error); }
    if (!result.ok) {
        const code = (KNOWN_CODES as readonly string[]).includes(result.error.code) ? result.error.code as ProviderErrorCode : 'invalid-response';
        throw new OnlineProviderError(code, result.error.message, 'lx');
    }
    return result.data as T;
}

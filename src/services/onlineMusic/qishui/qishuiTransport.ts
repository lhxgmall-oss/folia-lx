import { OnlineProviderError } from '../../../types/onlineMusic';
import type { JsonValue, ProviderErrorCode } from '../../../types/onlineMusic';

// Typed renderer boundary for the car bridge; credentials and player models stay in the main process.
export type QishuiOperation = 'login_status' | 'logout' | 'login_qr_key' | 'login_qr_create' | 'login_qr_check' | 'login_qr_cancel'
    | 'search' | 'search_playlists' | 'song_detail' | 'audio' | 'lyrics' | 'user_playlists' | 'playlist_detail' | 'playlist_tracks'
    | 'artist_detail' | 'artist_songs' | 'feed' | 'feed_modes';
export type QishuiParams = Record<string, JsonValue | undefined>;
export type QishuiBridgeResult = { ok: true; data: unknown } | { ok: false; error: { code: ProviderErrorCode; message: string; upstreamCode?: string; stage?: string } };
const STAGES = ['access-code', 'ticket', 'account'] as const;
export type QishuiLoginStage = typeof STAGES[number];
let lastFailure: { stage: QishuiLoginStage | null; code: ProviderErrorCode; upstreamCode?: string } | null = null;
export const getQishuiLastFailure = () => lastFailure;
export class QishuiRequestError extends OnlineProviderError {
    constructor(code: ProviderErrorCode, message: string, public readonly stage: QishuiLoginStage | null, public readonly upstreamCode?: string) {
        super(code, message, 'qishui');
    }
}
export const getQishuiAvailability = () => (
    typeof window !== 'undefined' && typeof window.electron?.qishuiRequest === 'function'
        ? { configured: true } as const : { configured: false, reason: 'runtime-unavailable' } as const
);
export async function requestQishui<T = unknown>(operation: QishuiOperation, params: QishuiParams = {}): Promise<T> {
    if (operation === 'login_qr_key') lastFailure = null;
    if (!getQishuiAvailability().configured) throw new OnlineProviderError('unavailable', 'Qishui requires the desktop app', 'qishui');
    let result: QishuiBridgeResult;
    try { result = await window.electron!.qishuiRequest(operation, params); }
    catch (error) { throw new OnlineProviderError('network', 'Qishui desktop request failed', 'qishui', error); }
    if (!result.ok) {
        const stage = STAGES.find(stage => stage === result.error.stage) ?? null;
        const upstreamCode = typeof result.error.upstreamCode === 'string' && /^\d{1,12}$/.test(result.error.upstreamCode) ? result.error.upstreamCode : undefined;
        lastFailure = { stage, code: result.error.code, upstreamCode };
        throw new QishuiRequestError(result.error.code, result.error.message, stage, upstreamCode);
    }
    return result.data as T;
}

// Scene artwork is public CDN content; it is fetched without any account headers or cookies.
export async function readQishuiSceneIcon(raw: string): Promise<string> {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/(?:^|\.)douyinpic\.com$/.test(url.hostname) || url.username || url.password) {
        throw new Error('Invalid scene artwork URL');
    }
    const response = await fetch(url.href, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Scene artwork is unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 512 * 1024) throw new Error('Scene artwork is too large');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:image/png;base64,${btoa(binary)}`;
}

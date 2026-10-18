import { OnlineProviderError } from '../../../types/onlineMusic';
import type { OnlineFailureDetail, OnlineFailureOperation } from '../../../types/onlineMusic';
import { LX_BRIDGE_FAILED, LX_NEEDS_DESKTOP } from './lxTransport';

// src/services/onlineMusic/lx/lxFailure.ts
// What a failed LX request for a song's audio or a list's songs hands to the shared rules
// (services/onlineMusic/failure/). The sentences matched here are the bridge's own
// (electron/lx/lxApiBridge.cjs, electron/lx/userApi/userApiManager.cjs).

const NO_SCRIPT = 'No LX source script is imported or active';

export const describeLxFailure = (_operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null => {
    if (!(error instanceof OnlineProviderError) || error.providerId !== 'lx') return null;
    if (error.message === LX_NEEDS_DESKTOP) return { case: 'not-configured' };
    if (error.message === LX_BRIDGE_FAILED) return { case: 'local-service-stopped' };
    // No custom source script imported, or the one in use did not load: the listener has to import one.
    if (error.code === 'unavailable') return { case: 'not-configured', message: error.message === NO_SCRIPT ? undefined : error.message };
    // The script answered, without a URL: its own words are all there is.
    if (error.code === 'not-playable') return { case: 'no-audio', message: error.message };
    if (error.code === 'network') return { case: 'unreachable', message: error.message };
    return { message: error.message };
};

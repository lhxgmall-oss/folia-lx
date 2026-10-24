// Types for the generated Android Qishui core (capacitor/qishui/androidQishui.js).
export interface AndroidQishuiCore {
    request(operation: string, params?: Record<string, unknown>): Promise<unknown>;
}
export function createAndroidQishuiCore(options: {
    fetch: (url: string, init?: any) => Promise<any>;
    store: { get(key: string): string | undefined; set(key: string, value: string): void; remove(key: string): void };
    onAudioSource?: (url: string) => unknown;
    log?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
}): AndroidQishuiCore;

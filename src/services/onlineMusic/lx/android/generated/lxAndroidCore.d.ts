// Types of the generated capacitor/lx/androidCore.js bundle (see dev/lx/bundleAndroidLx.mjs).
import type { LxBridgeResult } from '../../lxTransport';

export interface LxNativeHttpRequest {
    id: number;
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Uint8Array | null;
    timeout: number;
}

export interface LxNativeHttpResponse {
    status: number;
    statusText: string;
    headers: Record<string, string | string[]>;
    body: Uint8Array;
}

export interface AndroidLxCoreOptions {
    native: {
        send(request: LxNativeHttpRequest): Promise<LxNativeHttpResponse>;
        abort(id: number): void;
        registerMedia(url: string): Promise<void>;
    };
    files?: Record<string, string>;
    persist?: { write(path: string, text: string): void; remove(path: string): void } | null;
    createWorker(): Worker;
    pickFile(options: { kind: 'script' | 'list' }): Promise<Uint8Array | null>;
    log?: Pick<Console, 'info' | 'warn' | 'log' | 'error'>;
}

export interface AndroidLxCore {
    request(operation: string, params?: Record<string, unknown>): Promise<LxBridgeResult>;
    dispose(): void;
}

export function createAndroidLxCore(options: AndroidLxCoreOptions): AndroidLxCore;

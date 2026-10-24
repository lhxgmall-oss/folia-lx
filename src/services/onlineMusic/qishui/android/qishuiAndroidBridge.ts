import { registerPlugin } from '@capacitor/core';
import type { QishuiBridgeResult, QishuiOperation, QishuiParams } from 'qishui-music-api';
import { createAndroidQishuiCore } from './generated/qishuiAndroidCore.js';

// src/services/onlineMusic/qishui/android/qishuiAndroidBridge.ts
// The Qishui bridge of the Folia LX Android app (same contract as window.electron.qishuiRequest on desktop).
// The core (generated/qishuiAndroidCore.js, from capacitor/qishui/androidQishui.js) is qishui-music-api
// itself; this file hands it what Electron's main process gave it on desktop:
//   - fetch: the LxNative plugin (OkHttp), so requests carry no WebView cookies and need no CORS;
//   - the kept account and device id: localStorage (the app's private storage);
//   - audio URLs it hands out: registered with LxNative so LxWebViewClient answers them with CORS headers.

interface LxNativePlugin {
    request(options: { id: number; url: string; method: string; headers: Record<string, string>; bodyBase64?: string; timeout: number }):
        Promise<{ status: number; statusText: string; headers: Record<string, string | string[]>; bodyBase64: string }>;
    registerMedia(options: { url: string }): Promise<void>;
}
const LxNative = registerPlugin<LxNativePlugin>('LxNative');

const utf8ToBase64 = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return btoa(binary);
};
const base64ToUtf8 = (text: string) => {
    const binary = atob(text || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
};

let nextId = 900_000_000;
async function nativeFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    const answer = await LxNative.request({
        id: nextId++,
        url,
        method: init.method || 'GET',
        headers: init.headers || {},
        bodyBase64: typeof init.body === 'string' ? utf8ToBase64(init.body) : undefined,
        timeout: 25000,
    });
    const headers = new Map<string, string>();
    for (const [key, value] of Object.entries(answer.headers || {})) headers.set(key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value));
    const text = base64ToUtf8(answer.bodyBase64);
    return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        statusText: answer.statusText,
        headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
        json: async () => JSON.parse(text),
        text: async () => text,
    };
}

const PREFIX = 'folia-lx:qishui:';
const store = {
    get: (key: string) => window.localStorage.getItem(PREFIX + key) ?? undefined,
    set: (key: string, value: string) => window.localStorage.setItem(PREFIX + key, value),
    remove: (key: string) => window.localStorage.removeItem(PREFIX + key),
};

let core: ReturnType<typeof createAndroidQishuiCore> | null = null;

export function requestAndroidQishui(operation: QishuiOperation, params: QishuiParams = {}): Promise<QishuiBridgeResult> {
    core ??= createAndroidQishuiCore({
        fetch: nativeFetch,
        store,
        onAudioSource: (url: string) => LxNative.registerMedia({ url }).catch(() => {}),
    });
    return core.request(operation, params) as Promise<QishuiBridgeResult>;
}

import { registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { LxBridgeResult } from '../lxTransport';
import { createAndroidLxCore } from './generated/lxAndroidCore.js';
import type { AndroidLxCore, LxNativeHttpRequest, LxNativeHttpResponse } from './generated/lxAndroidCore.js';

// src/services/onlineMusic/lx/android/lxAndroidBridge.ts
// The LX bridge of the Android app. The core (generated/lxAndroidCore.js, from capacitor/lx/androidCore.js)
// is the desktop bridge itself, run in this WebView; this file hands it what Electron's main process gave
// it on desktop:
//   - native HTTP: the LxNative Capacitor plugin (android/app/src/main/java/top/izuna/foliamajor/lx/
//     LxNativePlugin.java, OkHttp), which also answers the audio URLs and covers the page reads
//     cross-origin with CORS headers (LxWebViewClient.java, the counterpart of electron/lx/mediaCors.cjs);
//   - the kept files (scripts, settings, imported lists): Capacitor Filesystem, app data directory,
//     folder folia-lx/ (lx-user-api/ and lx-my-lists/ as on desktop), read in full at start;
//   - the source script's process: a Web Worker (generated/lxScriptWorker.js);
//   - the file dialog: an <input type="file">, which Capacitor opens as the system file picker.

interface LxNativePlugin {
    request(options: { id: number; url: string; method: string; headers: Record<string, string>; bodyBase64?: string; timeout: number }):
        Promise<{ status: number; statusText: string; headers: Record<string, string | string[]>; bodyBase64: string }>;
    abort(options: { id: number }): Promise<void>;
    registerMedia(options: { url: string }): Promise<void>;
}

const LxNative = registerPlugin<LxNativePlugin>('LxNative');

const ROOT = 'folia-lx';

const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array => {
    const binary = atob(text || '');
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
    return out;
};

const native = {
    async send(request: LxNativeHttpRequest): Promise<LxNativeHttpResponse> {
        const answer = await LxNative.request({
            id: request.id,
            url: request.url,
            method: request.method,
            headers: request.headers,
            bodyBase64: request.body ? toBase64(request.body) : undefined,
            timeout: request.timeout,
        });
        return { status: answer.status, statusText: answer.statusText, headers: answer.headers || {}, body: fromBase64(answer.bodyBase64) };
    },
    abort(id: number) {
        void LxNative.abort({ id }).catch(() => {});
    },
    async registerMedia(url: string) {
        await LxNative.registerMedia({ url });
    },
};

// Every file under folia-lx/, as { '/lx-user-api/index.json': text, ... }.
async function readKeptFiles(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const walk = async (dir: string): Promise<void> => {
        let entries;
        try {
            entries = (await Filesystem.readdir({ path: dir, directory: Directory.Data })).files;
        } catch {
            return; // not there yet
        }
        for (const entry of entries) {
            const child = `${dir}/${entry.name}`;
            if (entry.type === 'directory') {
                await walk(child);
            } else if (!entry.name.endsWith('.tmp')) {
                try {
                    const read = await Filesystem.readFile({ path: child, directory: Directory.Data, encoding: Encoding.UTF8 });
                    files[child.slice(ROOT.length)] = typeof read.data === 'string' ? read.data : await read.data.text();
                } catch (error) {
                    console.warn('[LX] android: could not read a kept file', child, error);
                }
            }
        }
    };
    await walk(ROOT);
    return files;
}

// Writes reach the disk one after another, in the order the bridge made them.
let writeChain: Promise<unknown> = Promise.resolve();
const queue = (task: () => Promise<unknown>) => {
    writeChain = writeChain.then(task).catch(error => console.warn('[LX] android: writing a kept file failed', error));
};
const persist = {
    write(path: string, text: string) {
        queue(() => Filesystem.writeFile({ path: `${ROOT}${path}`, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true }));
    },
    remove(path: string) {
        queue(() => Filesystem.deleteFile({ path: `${ROOT}${path}`, directory: Directory.Data }).catch(() => {}));
    },
};

// The system file picker. No `accept`: Android knows neither .lxmc nor, reliably, .js by type, and a
// filter would hide the very file. Resolves null when the picker is closed without a choice.
function pickFile(): Promise<Uint8Array | null> {
    return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.style.display = 'none';
        let done = false;
        const finish = async (file: File | null) => {
            if (done) return;
            done = true;
            document.removeEventListener('visibilitychange', onVisible);
            input.remove();
            if (!file) { resolve(null); return; }
            resolve(new Uint8Array(await file.arrayBuffer()));
        };
        // Older WebViews fire no 'cancel': when the app comes back without a file, give 'change' a moment.
        const onVisible = () => {
            if (document.visibilityState !== 'visible') return;
            window.setTimeout(() => { if (!input.files?.length) void finish(null); }, 2000);
        };
        input.addEventListener('change', () => { void finish(input.files?.[0] || null); });
        input.addEventListener('cancel', () => { void finish(null); });
        document.addEventListener('visibilitychange', onVisible);
        document.body.appendChild(input);
        input.click();
    });
}

let corePromise: Promise<AndroidLxCore> | null = null;

const loadCore = (): Promise<AndroidLxCore> => {
    corePromise ??= readKeptFiles().then(files => createAndroidLxCore({
        native,
        files,
        persist,
        createWorker: () => new Worker(new URL('./generated/lxScriptWorker.js', import.meta.url), { type: 'module', name: 'Folia LX source script' }),
        pickFile: () => pickFile(),
        log: console,
    })).catch(error => {
        corePromise = null;
        throw error;
    });
    return corePromise;
};

/** One request to the Android LX bridge; same contract as window.electron.lxRequest on desktop. */
export async function requestAndroidLx(operation: string, params: Record<string, unknown>): Promise<LxBridgeResult> {
    const core = await loadCore();
    return core.request(operation, params);
}

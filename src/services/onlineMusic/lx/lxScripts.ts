import { requestLx } from './lxTransport';
import type { LxSubSource } from './lxNormalize';

// src/services/onlineMusic/lx/lxScripts.ts
// The custom source scripts (自定义源) the listener imported, and the LX settings, as the settings page
// reads and changes them. Kept by the main process (electron/lx/userApi/userApiManager.cjs).

export type LxQualitySetting = 'follow' | '128k' | '320k' | 'flac' | 'flac24bit';
export type LxSubSourceSetting = 'all' | LxSubSource;

export interface LxScriptInfo {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    homepage: string;
    importedAt: number;
}

export interface LxSettings {
    subSource: LxSubSourceSetting;
    quality: LxQualitySetting;
    fallback: boolean;
}

export interface LxState {
    apis: LxScriptInfo[];
    activeId: string | null;
    settings: LxSettings;
    status: {
        state: 'idle' | 'loading' | 'ready' | 'error';
        message: string;
        sources: Record<string, { type: string; actions: string[]; qualitys: string[] }>;
        updateAlert?: { log: string; updateUrl?: string };
    };
}

export const readLxState = () => requestLx<LxState>('state');
export const importLxScriptText = (script: string) => requestLx<LxScriptInfo>('script_import_text', { script });
export const importLxScriptUrl = (url: string) => requestLx<LxScriptInfo>('script_import_url', { url });
/** Opens the file picker in the main process; null when the listener cancels. */
export const importLxScriptFile = () => requestLx<LxScriptInfo | null>('script_import_file');
export const removeLxScript = (id: string) => requestLx<boolean>('script_remove', { id });
export const activateLxScript = (id: string | null) => requestLx('script_activate', { id });
export const updateLxSettings = (patch: Partial<LxSettings>) => requestLx<LxSettings>('settings_set', patch as Record<string, unknown>);

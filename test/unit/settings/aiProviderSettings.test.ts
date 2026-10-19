// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AiProviderSettings from '../../../src/components/modal/settings/pages/ai/AiProviderSettings';
import { SettingsPageContext, type ElectronSettingsState, type SettingsPageContextValue } from '../../../src/components/modal/settings/pages/settingsPageContext';

// Exercises the actual form guards so custom credentials cannot reach a default endpoint.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root | null = null;
let host: HTMLDivElement;
const save = vi.fn().mockResolvedValue(undefined);
const testAiConnection = vi.fn().mockResolvedValue({ ok: true, durationMs: 1, text: 'hello' });
const base: ElectronSettingsState = {
    AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'custom', OPENAI_API_URL: '', OPENAI_API_MODEL: 'selected-model',
    OPENAI_API_KEY: 'draft-key', OPENAI_API_TEMPERATURE: '0.7', OPENAI_API_STREAM: false,
    GEMINI_API_KEY: '', GEMINI_API_MODEL: 'gemini-selected', USE_SYSTEM_PROXY_FOR_AI: false,
    ENABLE_UPDATE_CHECK: true, ENABLE_AUTO_UPDATE: false, UPDATE_CHANNEL: 'realeco',
    STAGE_MODE_SOURCE: '', DISCORD_RICH_PRESENCE_ENABLED: false,
};
const render = async (patch: Partial<ElectronSettingsState>) => {
    const value = { viewProps: { desktop: { model: {
        electronSettings: { ...base, ...patch }, setElectronSettings: vi.fn(), onSaveElectronSettings: save,
        electronSaveStatus: 'idle', savedAiApiKeys: { GEMINI_API_KEY: false, OPENAI_API_KEY: false },
        savedOpenAIKeyEndpoint: null, onClearAiApiKey: vi.fn(),
    } } } } as unknown as SettingsPageContextValue;
    if (!root) {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    }
    await act(async () => {
        root!.render(React.createElement(SettingsPageContext.Provider, { value }, React.createElement(AiProviderSettings)));
    });
};
const button = (key: string) => [...host.querySelectorAll('button')].find(item => item.textContent === key)!;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
    await act(async () => { root?.unmount(); });
    host?.remove();
    root = null;
    vi.clearAllMocks();
    delete (window as any).electron;
});
describe('AI provider form connection guards', () => {
    it.each(['', '   '])('disables test and save for an empty custom URL %j even with a key and model', async apiUrl => {
        (window as any).electron = { testAiConnection };
        await render({ OPENAI_API_URL: apiUrl });
        expect(button('options.aiTestConnection').disabled).toBe(true);
        expect(button('options.save').disabled).toBe(true);
        await act(async () => { button('options.aiTestConnection').click(); button('options.save').click(); });
        expect(testAiConnection).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });
    it('enables both actions for a filled custom URL and passes its URL requirement to IPC', async () => {
        (window as any).electron = { testAiConnection };
        await render({ OPENAI_API_URL: 'https://custom.example/v1' });
        expect(button('options.aiTestConnection').disabled).toBe(false);
        expect(button('options.save').disabled).toBe(false);
        await act(async () => { button('options.aiTestConnection').click(); button('options.save').click(); });
        expect(testAiConnection).toHaveBeenCalledWith(expect.objectContaining({ requireApiUrl: true, apiUrl: 'https://custom.example/v1' }));
        expect(save).toHaveBeenCalledTimes(1);
    });
    it('keeps built-in provider defaults usable without a custom URL', async () => {
        (window as any).electron = { testAiConnection };
        await render({ AI_PROVIDER_PRESET: 'openai' });
        expect(button('options.aiTestConnection').disabled).toBe(false);
        await act(async () => { button('options.aiTestConnection').click(); });
        expect(testAiConnection).toHaveBeenCalledWith(expect.objectContaining({ requireApiUrl: false, apiUrl: 'https://api.openai.com/v1' }));
    });
});

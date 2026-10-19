import React from 'react';
import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AI_PROVIDER_PRESETS, DEFAULT_GEMINI_MODEL, getAiProviderPreset } from '../../../../../../shared/aiProviderPresets.mjs';
import { openAIEndpointOf } from '../../../../../utils/openAIEndpoint';
import { Button, FoldedGroup, NumberField, Reveal, Row, Select, TextField, Toggle, Value, option, parseNumberText, type SettingsGroupDef, type SettingsOptionDef } from '../../kit';
import { AiConnectionTestReply, useAiConnectionTest } from '../AiConnectionTest';
import { useSettingsPage, type AiApiKeyName, type ElectronSettingsState } from '../settingsPageContext';
import { AiModelPicker } from './AiModelPicker';

// AI connection settings, separated from appearance layout; requests stay behind services/aiText.
const AI: SettingsGroupDef = { id: 'electronSettings', titleKey: 'options.electronSettings', electronOnly: true };
const O = {
    provider: option(AI, 'aiProvider', 'options.aiProvider'),
    geminiKey: option(AI, 'geminiApiKey', 'options.geminiApiKey'),
    key: option(AI, 'openaiApiKey', 'options.aiApiKey'),
    url: option(AI, 'openaiApiUrl', 'options.aiApiUrl'),
    model: option(AI, 'openaiApiModel', 'options.aiModel'),
    geminiModel: option(AI, 'geminiApiModel', 'options.aiModel'),
    temperature: option(AI, 'openaiApiTemperature', 'options.openaiApiTemperature'),
    stream: option(AI, 'openaiApiStream', 'options.openaiApiStream'),
    proxy: option(AI, 'useSystemProxyAI', 'options.useSystemProxyAI'),
};
export const AI_SETTINGS_OPTIONS: SettingsOptionDef[] = Object.values(O);

/** Saved keys remain in the main process; this field contains only a typed replacement. */
const AiKeyField: React.FC<{ value: string; saved: boolean; onChange: (key: string) => void; onClear: () => void }> = ({ value, saved, onChange, onClear }) => {
    const { t } = useTranslation();
    return (
        <span className="flex min-w-0 items-center gap-2">
            <TextField type="password" value={value} onChange={onChange} placeholder={saved ? t('options.aiApiKeySavedPlaceholder') : ''} />
            {saved && <Button onClick={onClear}>{t('options.aiApiKeyClear')}</Button>}
        </span>
    );
};

const AiProviderSettings: React.FC = () => {
    const { t } = useTranslation();
    const { electronSettings: settings, setElectronSettings, onSaveElectronSettings, electronSaveStatus, savedAiApiKeys, savedOpenAIKeyEndpoint, onClearAiApiKey } = useSettingsPage().viewProps.desktop.model;
    const preset = getAiProviderPreset(settings);
    const gemini = preset.protocol === 'gemini';
    const keyName: AiApiKeyName = gemini ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
    const key = settings[keyName] || '';
    const apiUrl = preset.id === 'custom' ? settings.OPENAI_API_URL : preset.baseUrl;
    const mismatchedEndpoint = !gemini && savedOpenAIKeyEndpoint && savedOpenAIKeyEndpoint !== openAIEndpointOf(apiUrl)
        ? savedOpenAIKeyEndpoint : null;
    const usableSavedKey = savedAiApiKeys[keyName] && !mismatchedEndpoint;
    const setAi = (patch: Partial<ElectronSettingsState>) => setElectronSettings(previous => ({ ...previous, ...patch }));
    const model = gemini ? settings.GEMINI_API_MODEL || DEFAULT_GEMINI_MODEL : settings.OPENAI_API_MODEL || '';
    const payload: AiConnectionTestPayload = {
        provider: gemini ? 'gemini' : 'openai',
        apiProtocol: preset.protocol === 'anthropic' ? 'anthropic' : 'openai',
        apiKey: key,
        apiUrl: gemini ? undefined : apiUrl,
        model,
        stream: preset.protocol === 'openai' && settings.OPENAI_API_STREAM,
        useSystemProxy: settings.USE_SYSTEM_PROXY_FOR_AI,
    };
    const connection = useAiConnectionTest(payload, usableSavedKey);
    const selectProvider = (id: string) => {
        const next = AI_PROVIDER_PRESETS.find(value => value.id === id);
        if (!next || next.id === preset.id) return;
        setAi({
            AI_PROVIDER_PRESET: id,
            AI_PROVIDER: next.protocol === 'gemini' ? 'gemini' : 'openai',
            GEMINI_API_KEY: '',
            OPENAI_API_KEY: '',
            ...(next.protocol !== 'gemini' ? { OPENAI_API_URL: next.baseUrl, OPENAI_API_MODEL: '' } : {}),
        });
    };
    const keyHint = mismatchedEndpoint && !key.trim()
        ? t('options.aiApiKeyEndpointMismatchDesc', { endpoint: mismatchedEndpoint })
        : usableSavedKey ? t('options.aiApiKeySavedDesc') : undefined;

    return (
        <FoldedGroup def={AI} summary={t('options.aiProvider_' + preset.id)}>
            <Row option={O.provider}>
                <Select value={preset.id} options={AI_PROVIDER_PRESETS.map(value => ({ value: value.id, label: t('options.aiProvider_' + value.id) }))} onChange={selectProvider} />
            </Row>
            {preset.id === 'custom' && (
                <Row option={O.url}>
                    <TextField value={settings.OPENAI_API_URL} onChange={value => setAi({ OPENAI_API_URL: value })} placeholder={preset.baseUrl} />
                </Row>
            )}
            <Row option={gemini ? O.geminiKey : O.key} hint={keyHint}>
                <AiKeyField value={key} saved={usableSavedKey} onChange={value => setAi({ [keyName]: value })} onClear={() => void onClearAiApiKey(keyName)} />
            </Row>
            <AiModelPicker option={gemini ? O.geminiModel : O.model} payload={payload} keySaved={usableSavedKey} presetId={preset.id} onChange={value => setAi({ [gemini ? 'GEMINI_API_MODEL' : 'OPENAI_API_MODEL']: value })} />
            <Reveal when={!gemini}>
                <Row option={O.temperature} hint={t(preset.protocol === 'anthropic' ? 'options.aiTemperatureAnthropicDesc' : 'options.openaiApiTemperatureDesc')}>
                    <NumberField value={parseNumberText(settings.OPENAI_API_TEMPERATURE)}
                        onChange={value => setAi({ OPENAI_API_TEMPERATURE: value === null ? '' : String(value) })}
                        min={0} max={preset.protocol === 'anthropic' ? 1 : 2} step={0.1} placeholder="0.7" />
                </Row>
            </Reveal>
            <Reveal when={preset.protocol === 'openai'}>
                <Row option={O.stream} note={t('options.openaiApiStreamDesc')}>
                    <Toggle checked={settings.OPENAI_API_STREAM} onChange={enabled => setAi({ OPENAI_API_STREAM: enabled })} />
                </Row>
            </Reveal>
            <Row option={O.proxy} hint={t('options.useSystemProxyAIDesc')}>
                <Toggle checked={settings.USE_SYSTEM_PROXY_FOR_AI} onChange={enabled => setAi({ USE_SYSTEM_PROXY_FOR_AI: enabled })} />
            </Row>
            <Row below={connection.result && <AiConnectionTestReply result={connection.result} />}>
                {electronSaveStatus === 'saved' && <Value>{t('options.settingsSaved')}</Value>}
                <Button icon={Zap} tip={t('options.aiTestConnectionDesc')} onClick={() => void connection.run()} disabled={connection.running || !model.trim()}>
                    {t(connection.running ? 'options.aiTestRunning' : 'options.aiTestConnection')}
                </Button>
                <Button variant="primary" onClick={() => void onSaveElectronSettings()} disabled={electronSaveStatus === 'saving' || !model.trim()}>
                    {t(electronSaveStatus === 'saving' ? 'options.settingsSaving' : 'options.save')}
                </Button>
            </Row>
        </FoldedGroup>
    );
};

export default AiProviderSettings;

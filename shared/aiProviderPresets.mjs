// Provider connection presets shared by the settings form and the desktop AI client.
// Endpoint facts checked against LobeHub's packages/model-runtime/src/providers on 2026-10-19.
/** @typedef {{ id: string, label: string, protocol: 'gemini' | 'openai' | 'anthropic', baseUrl: string }} AiProviderPreset */
/** @type {readonly AiProviderPreset[]} */
export const AI_PROVIDER_PRESETS = Object.freeze([
    { id: 'gemini', label: 'Google Gemini', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    { id: 'deepseek', label: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
    { id: 'mimo', label: 'Xiaomi MiMo', protocol: 'openai', baseUrl: 'https://api.xiaomimimo.com/v1' },
    { id: 'qwen', label: 'Alibaba Cloud Qwen', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    { id: 'tencentcloud', label: 'Tencent Cloud', protocol: 'openai', baseUrl: 'https://api.lkeap.cloud.tencent.com/v1' },
    { id: 'openai', label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
    { id: 'anthropic', label: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
    { id: 'kimi', label: 'Kimi', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1' },
    { id: 'glm', label: 'Zhipu GLM', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
    { id: 'custom', label: '', protocol: 'openai', baseUrl: '' },
].sort((left, right) => left.id === 'custom' ? 1 : right.id === 'custom' ? -1 : left.label.localeCompare(right.label, 'en')));

export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';

/** Keeps old Gemini/compatible settings usable without guessing an Anthropic protocol migration. */
export const getAiProviderPreset = (settings = {}) => {
    const provider = settings.AI_PROVIDER === 'openai' ? 'openai' : 'gemini';
    const chosen = AI_PROVIDER_PRESETS.find(preset => preset.id === settings.AI_PROVIDER_PRESET);
    if (provider === 'gemini') return AI_PROVIDER_PRESETS.find(preset => preset.id === 'gemini') ?? AI_PROVIDER_PRESETS[0];
    const base = String(settings.OPENAI_API_URL || (chosen?.protocol !== 'gemini' && chosen?.baseUrl) || 'https://api.openai.com/v1')
        .trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    if (chosen?.protocol !== 'gemini' && chosen && (chosen.id === 'custom' || chosen.baseUrl === base)) return chosen;
    return AI_PROVIDER_PRESETS.find(preset => preset.protocol === 'openai' && preset.baseUrl === base)
        ?? AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1];
};

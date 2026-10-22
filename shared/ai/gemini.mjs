// shared/ai/gemini.mjs
// Google Gemini's native generateContent API. This file builds request bodies and the address;
// the main process sends them (sendGemini in electron/aiTextClient.cjs). Gemini is chosen by the
// AI_PROVIDER setting, never inferred from OPENAI_API_URL, so it claims no host: Gemini's
// OpenAI-compatible endpoint typed as a custom URL stays custom. The request is still the one sent
// before adapters existed: the tuned zero thinking budget only on the default model, nothing
// reasoning-related on any other.

export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** The generateContent address for `model` (already validated by the caller). */
export const generateContentUrl = (model) => `${API_BASE}/models/${model}:generateContent`;

const PLAIN = Object.freeze([{ label: 'plain', reasoningOff: true, params: {}, knobs: [] }]);
// gemini-3-flash-preview thinks by default; a zero budget is what SEGMENTATION_GEMINI_GENERATION_CONFIG
// measured (9.0 s down to 1.6 s for identical output). The PR dropped it for every other model.
const THINKING_OFF = Object.freeze([{ label: 'thinkingBudget=0', reasoningOff: true, params: { thinkingBudget: 0 }, knobs: ['thinkingConfig'] }]);

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const geminiAdapter = {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'gemini',
    hosts: [],
    endpoints: [{ id: 'default', baseUrl: API_BASE }],
    defaultModel: DEFAULT_GEMINI_MODEL,
    recommendedModel: DEFAULT_GEMINI_MODEL,
    temperature: null,
    stream: false,
    tokenField: 'maxOutputTokens',
    attempts(task, model) {
        return task !== 'theme' && model === DEFAULT_GEMINI_MODEL ? THINKING_OFF : PLAIN;
    },
    /**
     * generateContent body for one attempt. `attempt.params` is the content of `thinkingConfig`
     * (sent only when not empty); `geminiSchema` is in Gemini's own uppercase schema dialect.
     *
     * @param {import('./providerRegistry.mjs').AiBodyRequest} request
     */
    buildBody({ task, attempt, systemPrompt, sourcePrompt, geminiSchema, budget }) {
        const limit = budget ? { maxOutputTokens: budget } : {};
        const thinking = Object.keys(attempt.params).length ? { thinkingConfig: { ...attempt.params } } : {};
        const contents = [{ parts: [{ text: sourcePrompt }] }];
        if (task === 'test') {
            return { contents, generationConfig: { ...limit, ...thinking } };
        }
        return {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
                responseMimeType: 'application/json',
                ...(geminiSchema ? { responseSchema: geminiSchema } : {}),
                ...limit,
                ...thinking,
            },
        };
    },
    models: {
        rows: (json) => json.models,
        id: (row) => row.name,
        name: (row) => row.display_name ?? row.displayName ?? row.modelName,
        keep: (row, id) => Array.isArray(row.supportedGenerationMethods)
            && row.supportedGenerationMethods.includes('generateContent')
            && /^[\w.-]+$/.test(id),
        next: (json) => (json.nextPageToken ? { param: 'pageToken', value: String(json.nextPageToken) } : null),
    },
};

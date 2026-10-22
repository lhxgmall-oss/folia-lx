import { COMPATIBLE_MODEL_CATALOGUE, GENERIC_REASONING_LADDER, PLAIN_ATTEMPTS } from './compatibleBody.mjs';

// shared/ai/deepseek.mjs
// DeepSeek (api.deepseek.com and its other subdomains). Plain JSON mode only. The request is still
// the one sent before adapters existed: segmentation walks the generic ladder with DeepSeek's own
// `thinking: disabled` switch on every rung; the theme and the test send nothing reasoning-related.

export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';

// `thinking` is not a knob here: when DeepSeek refuses it, the transport drops it and retries
// (sendOpenAICompatibleRequest), so only the ladder's own parameter moves to the next rung.
const SEGMENTATION_ATTEMPTS = Object.freeze(GENERIC_REASONING_LADDER.map((attempt) => Object.freeze({
    ...attempt,
    params: { thinking: { type: 'disabled' }, ...attempt.params },
})));

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const deepseekAdapter = {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    hosts: ['api.deepseek.com'],
    hostSuffixes: ['.deepseek.com'],
    endpoints: [{ id: 'default', baseUrl: 'https://api.deepseek.com/v1' }],
    defaultModel: DEEPSEEK_DEFAULT_MODEL,
    recommendedModel: DEEPSEEK_DEFAULT_MODEL,
    temperature: { min: 0, max: 2 },
    stream: true,
    tokenField: 'max_tokens',
    attempts(task) {
        return task === 'segmentation' ? SEGMENTATION_ATTEMPTS : PLAIN_ATTEMPTS;
    },
    responseFormat: () => ({ type: 'json_object' }),
    models: COMPATIBLE_MODEL_CATALOGUE,
};

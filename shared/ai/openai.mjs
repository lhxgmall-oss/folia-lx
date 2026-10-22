import { COMPATIBLE_MODEL_CATALOGUE, GENERIC_REASONING_LADDER, PLAIN_ATTEMPTS } from './compatibleBody.mjs';

// shared/ai/openai.mjs
// OpenAI itself: api.openai.com and its data-residency subdomains (eu., jp. and so on). The only
// host that gets a strict json_schema and `max_completion_tokens`. The request is still the one
// sent before adapters existed: the generic ladder for segmentation, nothing reasoning-related for
// the theme and the test.

export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';

// The theme handler gave OpenAI 4096 tokens (it was the only host on a strict schema) and every
// other host 8192. Kept until the theme budget follows budgetFor here as well.
const THEME_ATTEMPTS = Object.freeze([{ ...PLAIN_ATTEMPTS[0], maxTokens: 4096 }]);

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const openaiAdapter = {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    hosts: ['api.openai.com'],
    hostSuffixes: ['.openai.com'],
    endpoints: [{ id: 'default', baseUrl: 'https://api.openai.com/v1' }],
    defaultModel: DEFAULT_OPENAI_MODEL,
    recommendedModel: DEFAULT_OPENAI_MODEL,
    temperature: { min: 0, max: 2 },
    stream: true,
    tokenField: 'max_completion_tokens',
    attempts(task) {
        if (task === 'segmentation') {
            return GENERIC_REASONING_LADDER;
        }
        return task === 'theme' ? THEME_ATTEMPTS : PLAIN_ATTEMPTS;
    },
    responseFormat: (_model, schema, schemaName) => (schema && schemaName
        ? { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }
        : { type: 'json_object' }),
    models: COMPATIBLE_MODEL_CATALOGUE,
};

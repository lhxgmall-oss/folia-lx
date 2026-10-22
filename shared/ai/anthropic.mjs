import { COMPATIBLE_MODEL_CATALOGUE, PLAIN_ATTEMPTS, temperatureFor } from './compatibleBody.mjs';

// shared/ai/anthropic.mjs
// Anthropic's native Messages API (api.anthropic.com). This file only builds request bodies; the
// main process sends them through electron/ai/anthropicClient.cjs. The body is still the one the
// settings PR introduced: the schema as a forced tool, temperature clamped to 0..1, one attempt per
// ask with nothing reasoning-related.

// Messages requires max_tokens; this is what the PR's sender fell back to without a budget.
const FALLBACK_MAX_TOKENS = 8192;

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const anthropicAdapter = {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    hosts: ['api.anthropic.com'],
    endpoints: [{ id: 'default', baseUrl: 'https://api.anthropic.com/v1' }],
    // No default: a blank model must be chosen in settings rather than guessed.
    defaultModel: null,
    recommendedModel: 'claude-haiku-5-5',
    temperature: { min: 0, max: 1 },
    stream: false,
    tokenField: 'max_tokens',
    attempts() {
        return PLAIN_ATTEMPTS;
    },
    /**
     * Messages body for one attempt. A schema is requested as a forced tool named `schemaName`;
     * the sender reads that tool's input back as the JSON answer.
     *
     * @param {import('./providerRegistry.mjs').AiBodyRequest} request
     */
    buildBody({ task, model, attempt, systemPrompt, sourcePrompt, schema, schemaName, budget, temperature }) {
        const toolName = schemaName || 'response';
        const sentTemperature = task === 'test' ? undefined : temperatureFor(anthropicAdapter, model, attempt, temperature);
        return {
            model,
            max_tokens: budget ?? FALLBACK_MAX_TOKENS,
            ...(systemPrompt && task !== 'test' ? { system: systemPrompt } : {}),
            messages: [{ role: 'user', content: sourcePrompt }],
            ...(sentTemperature === undefined ? {} : { temperature: sentTemperature }),
            ...attempt.params,
            ...(schema && task !== 'test' ? {
                tools: [{ name: toolName, description: 'Return the requested result.', input_schema: schema }],
                tool_choice: { type: 'tool', name: toolName },
            } : {}),
        };
    },
    models: { ...COMPATIBLE_MODEL_CATALOGUE, next: (json, rows) => (json.has_more === true
        ? { param: 'after_id', value: json.last_id ?? rows.at(-1)?.id }
        : null) },
};

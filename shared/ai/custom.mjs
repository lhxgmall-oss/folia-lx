import { REASONING_SUPPRESSION_ATTEMPTS } from '../lyricSegmentationPrompt.mjs';

// shared/ai/custom.mjs
// Any other OpenAI-compatible endpoint (a relay, a local server, a provider without an adapter).
// Nothing is known about it, so segmentation walks the generic ladder in REASONING_SUPPRESSION_ATTEMPTS
// and the other asks send no reasoning parameter at all.

export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';

const labelOf = (params) => Object.keys(params).join('+') || 'plain';

/** The bare request: nothing reasoning-related, budget for the answer only (as before adapters). */
const PLAIN_ATTEMPTS = Object.freeze([{ label: 'plain', reasoningOff: true, params: {}, knobs: [] }]);

const SEGMENTATION_ATTEMPTS = Object.freeze(REASONING_SUPPRESSION_ATTEMPTS.map(({ params }, index, all) => ({
    label: labelOf(params),
    // The last rung sends nothing, for models whose reasoning cannot be switched off, so it needs room
    // for the reasoning and the answer; the earlier rungs expect no reasoning at all.
    reasoningOff: index < all.length - 1,
    params,
    knobs: Object.keys(params),
})));

export const customAdapter = {
    id: 'custom',
    label: '',
    protocol: 'openai',
    hosts: [],
    endpoints: [{ id: 'default', baseUrl: '' }],
    defaultModel: DEFAULT_OPENAI_MODEL,
    temperature: { min: 0, max: 2 },
    stream: true,
    tokenField: 'max_tokens',
    attempts(task) {
        return task === 'segmentation' ? SEGMENTATION_ATTEMPTS : PLAIN_ATTEMPTS;
    },
    responseFormat: () => ({ type: 'json_object' }),
    models: null,
};

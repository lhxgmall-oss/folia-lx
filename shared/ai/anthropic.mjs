// shared/ai/anthropic.mjs
// Anthropic's native Messages API (api.anthropic.com). This file only builds request bodies; the
// main process sends them through electron/ai/anthropicClient.cjs.
//
// What each ask sends depends on the model [Anthropic·models][Anthropic·thinking][Anthropic·effort]:
// thinking is switched off where the model allows it, and otherwise turned down with
// output_config.effort; the JSON answer is asked for with output_config.format, never with a
// forced tool (opus-5-5, sonnet-5-5, fable-5-1 and mythos-5-1 reject tool_choice any/tool with a
// 400) [Anthropic·structured-outputs]. Temperature is never sent: the 4.7-and-later models reject
// it, and the rest do not need it [Anthropic·messages].

// Messages requires max_tokens; used only when a caller gives no answer budget at all.
const FALLBACK_MAX_TOKENS = 8192;

/** One request shape; `params` are top-level body fields, `output_config` merged with the format. */
const attempt = (label, reasoningOff, params) => Object.freeze({
    label,
    reasoningOff,
    params: Object.freeze(params),
    knobs: Object.freeze(Object.keys(params)),
});

const EFFORT_LOW = Object.freeze({ effort: 'low' });
// Thinking off, effort low. Accepted by haiku-5-5 and opus-5 only at effort high or below, which
// low is [Anthropic·thinking].
const DISABLED_LOW = attempt('thinking=disabled+effort=low', true, { thinking: { type: 'disabled' }, output_config: EFFORT_LOW });
// sonnet-5-5 rejects 'disabled'; between_tools thinks only between tool calls, and these asks have
// none. It takes no other field and needs effort high or below [Anthropic·sonnet-5-5]. Budgeted as
// thinking anyway, to be safe.
const BETWEEN_TOOLS_LOW = attempt('thinking=between_tools+effort=low', false, { thinking: { type: 'between_tools' }, output_config: EFFORT_LOW });
// Thinking left on (or always on), as little of it as the model does.
const LOW = attempt('effort=low', false, { output_config: EFFORT_LOW });
// Models that do not think unless asked to: nothing to switch off.
const QUIET = attempt('plain', true, {});
// Nothing sent: the model's own default, which may think.
const MODEL_DEFAULT = attempt('thinking=default', false, {});

/**
 * Per model, by family and version (`haiku-5-5`, `opus-5`, `sonnet-4-6`...): `quiet` is what
 * segmentation and the connection test send (thinking off, or as low as it goes; the test uses the
 * same switch so a pass means segmentation's is accepted too), `theme` what the theme sends (low
 * effort), `alwaysThinks` whether thinking cannot be switched off at all.
 */
const FAMILIES = new Map([
    // Thinking on by default, 'disabled' accepted [Anthropic·thinking].
    ...['haiku-5-5', 'opus-5', 'sonnet-5'].map((name) => [name, { quiet: [DISABLED_LOW], theme: [LOW] }]),
    ['sonnet-5-5', { quiet: [BETWEEN_TOOLS_LOW], theme: [LOW] }],
    // Thinking always on: 'disabled' and budget_tokens are a 400 at every effort; effort is the only
    // control [Anthropic·models][Anthropic·opus-5-5].
    ...['opus-5-5', 'fable-5-1', 'fable-5', 'mythos-5-1', 'mythos-5']
        .map((name) => [name, { quiet: [LOW], theme: [LOW], alwaysThinks: true }]),
    // No thinking unless asked for. haiku-4-5 and sonnet-4-5 also reject effort, so nothing is sent
    // to any of them [Anthropic·effort].
    ...['opus-4-8', 'opus-4-7', 'opus-4-6', 'sonnet-4-6', 'opus-4-5', 'sonnet-4-5', 'haiku-4-5']
        .map((name) => [name, { quiet: [QUIET], theme: [QUIET] }]),
]);

// Any other model: thinking off first, then low effort, then nothing; each moves on only when the
// endpoint rejects that field by name.
const UNKNOWN = Object.freeze({ quiet: [DISABLED_LOW, LOW, MODEL_DEFAULT], theme: [LOW, MODEL_DEFAULT] });

// `claude-<family>-<major>[-<minor>]`, then the end, a snapshot date, or a Vertex `@` version.
const MODEL_NAME = /(?:^|[./])claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?=$|[-@:])/;

const familyOf = (model) => {
    const match = MODEL_NAME.exec(String(model ?? '').trim().toLowerCase());
    if (!match) {
        return undefined;
    }
    const [, family, major, minor] = match;
    return FAMILIES.get(minor === undefined ? `${family}-${major}` : `${family}-${major}-${minor}`);
};

// JSON Schema keywords structured outputs do not support: numerical, string-length and array or
// object size constraints [Anthropic·structured-outputs]. Our two schemas use none of them today.
const UNSUPPORTED_KEYWORDS = new Set([
    'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
    'minLength', 'maxLength',
    'minItems', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'maxContains',
    'minProperties', 'maxProperties',
]);
const SCHEMA_LISTS = ['anyOf', 'allOf', 'oneOf', 'prefixItems'];
const SCHEMA_MAPS = ['properties', '$defs', 'definitions'];

/**
 * A copy of `schema` that structured outputs accept: the unsupported keywords dropped, and every
 * object closed with `additionalProperties: false`, the only value allowed. Only schema positions
 * are walked, so a property that happens to be named `minimum` is kept. The answer is still
 * validated by the caller (parseSegmentationResponse, sanitizeDualTheme).
 */
export const structuredOutputSchema = (schema) => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        return schema;
    }
    const copy = {};
    for (const [key, value] of Object.entries(schema)) {
        if (UNSUPPORTED_KEYWORDS.has(key)) {
            continue;
        }
        if (SCHEMA_MAPS.includes(key) && value && typeof value === 'object') {
            copy[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, structuredOutputSchema(child)]));
        } else if (SCHEMA_LISTS.includes(key) && Array.isArray(value)) {
            copy[key] = value.map(structuredOutputSchema);
        } else if (key === 'items' || key === 'not') {
            copy[key] = Array.isArray(value) ? value.map(structuredOutputSchema) : structuredOutputSchema(value);
        } else {
            copy[key] = value;
        }
    }
    const isObject = schema.type === 'object' || (Array.isArray(schema.type) && schema.type.includes('object')) || 'properties' in schema;
    if (isObject) {
        copy.additionalProperties = false;
    }
    return copy;
};

/** `{ type, message }` from an Anthropic error body (`{ type: 'error', error: { type, message } }`), or the raw text as the message. */
const errorOf = (errorBody) => {
    const text = String(errorBody ?? '');
    try {
        const error = JSON.parse(text)?.error;
        if (error && typeof error.message === 'string') {
            return { type: typeof error.type === 'string' ? error.type : '', message: error.message };
        }
    } catch {
        // Not JSON: match the text itself.
    }
    return { type: '', message: text };
};

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const anthropicAdapter = {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    hosts: ['api.anthropic.com'],
    endpoints: [{ id: 'default', baseUrl: 'https://api.anthropic.com/v1' }],
    // No default: a blank model must be chosen in settings rather than guessed.
    defaultModel: null,
    // The cheapest, and it can switch thinking off at low effort [Anthropic·haiku-5-5].
    recommendedModel: 'claude-haiku-5-5',
    temperature: null,
    stream: false,
    tokenField: 'max_tokens',
    attempts(task, model) {
        const family = familyOf(model) ?? UNKNOWN;
        return task === 'theme' ? family.theme : family.quiet;
    },
    /**
     * Messages body for one attempt. A schema is asked for as `output_config.format` (merged with
     * the attempt's effort); the test sends neither system prompt nor schema. max_tokens counts
     * thinking too, so it is budgetFor's answer-plus-thinking figure [Anthropic·thinking].
     *
     * @param {import('./providerRegistry.mjs').AiBodyRequest} request
     */
    buildBody({ task, model, attempt, systemPrompt, sourcePrompt, schema, budget }) {
        const { output_config: attemptOutput, ...params } = attempt.params;
        const format = schema && task !== 'test'
            ? { format: { type: 'json_schema', schema: structuredOutputSchema(schema) } }
            : {};
        const outputConfig = { ...(attemptOutput ?? {}), ...format };
        return {
            model,
            max_tokens: budget ?? FALLBACK_MAX_TOKENS,
            ...(systemPrompt && task !== 'test' ? { system: systemPrompt } : {}),
            messages: [{ role: 'user', content: sourcePrompt }],
            ...structuredClone(params),
            ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
        };
    },
    /**
     * A 400 invalid_request_error that names this attempt's field: `thinking` (for example
     * `"thinking.type.disabled" is not supported for this model`), or the effort inside
     * output_config. A complaint about output_config's format is not a reason to move on: every
     * attempt sends the same format [Anthropic·errors].
     */
    rejectedParameter(status, errorBody, knob) {
        const { type, message } = errorOf(errorBody);
        if (status !== 400 || (type && type !== 'invalid_request_error')) {
            return false;
        }
        if (knob === 'thinking') {
            return /thinking/i.test(message);
        }
        if (knob === 'output_config') {
            return /effort/i.test(message) || (/output_config/i.test(message) && !/format|schema/i.test(message));
        }
        return false;
    },
    models: {
        // 1000 is the largest page; has_more and last_id continue it with after_id [Anthropic·models-list].
        query: { limit: '1000' },
        rows: (json) => json.data,
        id: (row) => row.id,
        name: (row) => row.display_name,
        keep: () => true,
        next: (json, rows) => (json.has_more === true ? { param: 'after_id', value: json.last_id ?? rows.at(-1)?.id } : null),
    },
    // Retired, or retiring on 2026-11-30 (sonnet-4-5) [Anthropic·deprecations].
    retired: [
        { pattern: /^claude-3/, replacement: 'claude-haiku-5-5' },
        { pattern: /^claude-(?:opus|sonnet)-4-(?:0|1)(?:$|-)/, replacement: 'claude-haiku-5-5' },
        { pattern: /^claude-(?:opus|sonnet)-4-\d{8}/, replacement: 'claude-haiku-5-5' },
        { pattern: /^claude-sonnet-4-5/, replacement: 'claude-haiku-5-5' },
    ],
    /** True for the models whose thinking cannot be switched off at all. */
    alwaysThinks(model) {
        return Boolean(familyOf(model)?.alwaysThinks);
    },
};

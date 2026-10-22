import { rejectsOpenAICompatibleParameter } from '../openAICompatibleRequest.mjs';

// shared/ai/compatibleBody.mjs
// The OpenAI-compatible protocol's shared parts: reading a reply for "reasoning ate the budget"
// and the default "this parameter was rejected" check. Every adapter whose protocol is 'openai'
// uses these unless it says otherwise.

/** Reasoning tokens the provider reported, if any. */
export const reasoningTokensOf = (usage) => {
    const details = usage && usage.completion_tokens_details;
    const tokens = details && details.reasoning_tokens;
    return typeof tokens === 'number' ? tokens : 0;
};

/**
 * True when the model answered nothing because reasoning consumed the whole budget. This is the
 * failure that looks like success: HTTP 200, tokens billed, `content` empty.
 */
export const exhaustedByReasoning = (choice, usage) => {
    const hasReasoning = Boolean(
        reasoningTokensOf(usage) || (choice && choice.message && choice.message.reasoning_content),
    );
    return hasReasoning && Boolean(choice) && choice.finish_reason === 'length';
};

/**
 * The default rejected-parameter check: a 400/422 whose raw error body names `knob`, by
 * `error.param` or by one of the wordings the shared detector knows.
 *
 * @param {number} status
 * @param {string} errorBody the provider's raw error body (a formatted error line also works)
 * @param {string} knob a top-level request field
 */
export const rejectsCompatibleParameter = (status, errorBody, knob) => (
    rejectsOpenAICompatibleParameter(status, String(errorBody ?? ''), knob)
);

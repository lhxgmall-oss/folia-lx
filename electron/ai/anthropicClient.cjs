'use strict';

// Native Messages API transport. The existing settings and credential slot still own this connection.
// Request bodies come from shared/ai/anthropic.mjs; this file only sends them, reads the reply and
// classifies failures, so a change to what Claude is asked lives in the adapter.
const normalizeAnthropicMessagesUrl = (rawUrl) => {
    const url = new URL(rawUrl || 'https://api.anthropic.com/v1');
    let path = url.pathname.replace(/\/+$/, '').replace(/\/(?:messages|chat\/completions|models)$/, '');
    if (!path) path = '/v1';
    url.pathname = path + '/messages';
    return url.toString();
};

const anthropicHeaders = (apiKey) => ({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
});

// The shared runner and budgets are ESM, loaded on first use.
const loadShared = () => Promise.all([
    import('../../shared/ai/attemptRunner.mjs'),
    import('../../shared/ai/aiTasks.mjs'),
]).then(([runner, tasks]) => ({ ...runner, ...tasks }));

/**
 * Sends one Messages body and returns `{ content, model, status }`. When the body forces a tool,
 * that tool's input comes back as the JSON text; otherwise the text blocks, joined.
 */
async function sendAnthropic({ apiUrl, apiKey, body, customFetch, timeoutMs = 120_000 }) {
    const model = typeof body?.model === 'string' ? body.model : '';
    if (!model || model.length > 256 || /[\s\u0000-\u001f\u007f]/.test(model)) {
        throw new Error('Select a valid Anthropic model in settings');
    }
    const request = { ...body };
    const toolName = request.tool_choice?.type === 'tool' ? request.tool_choice.name : null;
    const signal = AbortSignal.timeout(timeoutMs);
    const send = () => customFetch(normalizeAnthropicMessagesUrl(apiUrl), {
        method: 'POST', redirect: 'error', headers: anthropicHeaders(apiKey), signal, body: JSON.stringify(request),
    });
    let response = await send();
    // New Claude models reject custom sampling values; keep older models' temperature setting.
    if (response.status === 400 && request.temperature !== undefined) {
        const error = await response.json().catch(() => null);
        if (error?.error?.type === 'invalid_request_error'
            && /temperature/i.test(error.error.message)
            && /not.support|does.not.support|non.default|deprecated|only.*1/i.test(error.error.message)) {
            delete request.temperature;
            console.info('[ai] Model does not accept temperature; using the provider default');
            response = await send();
        }
    }
    if (!response.ok) {
        // Provider bodies may echo credentials. Status is enough here, including the real caller's logs.
        const error = new Error('Anthropic request failed (HTTP ' + response.status + ')');
        error.status = response.status;
        throw error;
    }
    const data = await response.json();
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const tool = toolName && blocks.find(block => block?.type === 'tool_use' && block.name === toolName);
    const text = tool
        ? JSON.stringify(tool.input)
        : blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
    if (!text?.trim()) throw new Error('Model returned an empty response');
    return { content: text, model: typeof data.model === 'string' ? data.model : model, status: response.status };
}

/** One attempt as the shared runner expects it: HTTP failures come back, anything else is thrown. */
const sendAttempt = async (options) => {
    try {
        return { ok: true, ...(await sendAnthropic(options)) };
    } catch (error) {
        if (error && error.status) {
            return { ok: false, status: error.status, errorText: error.message };
        }
        throw error;
    }
};

/**
 * Raw JSON text for one ask (`task`), walking the adapter's attempts with the shared runner.
 * `temperature` is the user's setting; the adapter decides whether and how it is sent.
 */
async function runAnthropicCompletion({
    adapter, task, apiUrl, apiKey, model, systemPrompt, sourcePrompt, schema, schemaName,
    answerTokens, temperature, customFetch, timeoutMs,
}) {
    const { runAttempts, budgetFor } = await loadShared();
    return runAttempts({
        adapter,
        task,
        url: normalizeAnthropicMessagesUrl(apiUrl),
        model,
        attempts: adapter.attempts(task, model),
        log: (line) => console.log(line),
        describeEmpty: () => 'Model returned an empty response',
        send: (attempt) => sendAttempt({
            apiUrl,
            apiKey,
            body: adapter.buildBody({
                task, model, attempt, systemPrompt, sourcePrompt, schema, schemaName,
                budget: budgetFor(task, answerTokens, attempt), temperature,
            }),
            customFetch,
            timeoutMs,
        }),
    });
}

/**
 * The connection test's "hello" over the Messages API. Never throws; resolves to
 * `{ ok: true, status, model, text, emptyReason? }` or `{ ok: false, error, status?, errorKind }`,
 * unredacted (the caller redacts and truncates).
 */
async function runAnthropicConnectionTest({ adapter, apiUrl, apiKey, model, prompt, answerTokens, customFetch, timeoutMs }) {
    try {
        const { walkAttempts, budgetFor } = await loadShared();
        const { result } = await walkAttempts({
            adapter,
            task: 'test',
            url: normalizeAnthropicMessagesUrl(apiUrl),
            model,
            attempts: adapter.attempts('test', model),
            cache: null,
            send: (attempt) => sendAttempt({
                apiUrl,
                apiKey,
                body: adapter.buildBody({ task: 'test', model, attempt, sourcePrompt: prompt, budget: budgetFor('test', answerTokens, attempt) }),
                customFetch,
                timeoutMs,
            }),
        });
        if (!result.ok) {
            return { ok: false, error: result.errorText, status: result.status, errorKind: 'http' };
        }
        return { ok: true, status: result.status, model: result.model, text: result.content };
    } catch (error) {
        return { ok: false, error, errorKind: /Timeout|Abort/.test(error?.name) ? 'timeout' : 'network' };
    }
}

module.exports = { normalizeAnthropicMessagesUrl, anthropicHeaders, sendAnthropic, runAnthropicCompletion, runAnthropicConnectionTest };

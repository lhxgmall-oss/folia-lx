'use strict';

// Native Messages API transport. The existing settings and credential slot still own this connection.
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

/** Sends either plain text or a forced schema tool, which returns the JSON the existing callers validate. */
async function sendAnthropic({
    apiUrl, apiKey, model, systemPrompt, sourcePrompt, schema, schemaName,
    temperature, maxTokens = 8192, customFetch, timeoutMs = 120_000,
}) {
    if (!model || typeof model !== 'string') throw new Error('Select an Anthropic model in settings');
    const toolName = schemaName || 'response';
    const body = {
        model,
        max_tokens: maxTokens,
        ...(systemPrompt ? { system: systemPrompt } : {}),
        messages: [{ role: 'user', content: sourcePrompt }],
        ...(Number.isFinite(temperature) ? { temperature: Math.max(0, Math.min(1, temperature)) } : {}),
        ...(schema ? {
            tools: [{ name: toolName, description: 'Return the requested result.', input_schema: schema }],
            tool_choice: { type: 'tool', name: toolName },
        } : {}),
    };
    const signal = AbortSignal.timeout(timeoutMs);
    const send = () => customFetch(normalizeAnthropicMessagesUrl(apiUrl), {
        method: 'POST', redirect: 'error', headers: anthropicHeaders(apiKey), signal, body: JSON.stringify(body),
    });
    let response = await send();
    // New Claude models reject custom sampling values; keep older models' temperature setting.
    if (response.status === 400 && body.temperature !== undefined) {
        const error = await response.json().catch(() => null);
        if (error?.error?.type === 'invalid_request_error'
            && /temperature/i.test(error.error.message)
            && /not.support|does.not.support|non.default|deprecated|only.*1/i.test(error.error.message)) {
            delete body.temperature;
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
    const tool = schema && blocks.find(block => block?.type === 'tool_use' && block.name === toolName);
    const text = tool
        ? JSON.stringify(tool.input)
        : blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
    if (!text?.trim()) throw new Error('Model returned an empty response');
    return { content: text, model: typeof data.model === 'string' ? data.model : model, status: response.status };
}

module.exports = { normalizeAnthropicMessagesUrl, anthropicHeaders, sendAnthropic };

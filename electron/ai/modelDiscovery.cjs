'use strict';

const { normalizeOpenAIChatCompletionsUrl, validateAiConnectionTestInput } = require('../aiTextClient.cjs');
const { normalizeAnthropicMessagesUrl, anthropicHeaders } = require('./anthropicClient.cjs');

// Model discovery uses the same main-process credentials and proxy as completion requests.
const MAX_PAGES = 20;
const MAX_MODELS = 2000;
const MAX_BODY_BYTES = 2_000_000;

/** Stops reading oversized catalogues before allocating the complete response body. */
async function readCatalogue(response) {
    const reader = response.body?.getReader();
    if (!reader) throw new SyntaxError('Missing catalogue body');
    const decoder = new TextDecoder();
    let text = '';
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BODY_BYTES) {
                await reader.cancel();
                throw new RangeError('Catalogue too large');
            }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
    } finally {
        reader.releaseLock();
    }
    return JSON.parse(text);
}

const modelListUrl = ({ provider, apiUrl, apiProtocol }) => {
    if (provider === 'gemini') return new URL('https://generativelanguage.googleapis.com/v1beta/models');
    const url = new URL(apiProtocol === 'anthropic' ? normalizeAnthropicMessagesUrl(apiUrl) : normalizeOpenAIChatCompletionsUrl(apiUrl));
    url.pathname = url.pathname.replace(/\/(?:chat\/completions|messages|models)\/?$/, '') + '/models';
    // GLM uses its model catalogue rather than a standard /models route (as in LobeHub's ZhiPu runtime).
    if (url.hostname === 'open.bigmodel.cn' && /^\/api\/paas\/v4\/models$/.test(url.pathname)) {
        url.pathname = '/api/fine-tuning/model_center/list';
        url.searchParams.set('pageSize', '100');
        url.searchParams.set('pageNum', '1');
    }
    return url;
};

const failure = (errorKind, status) => ({ ok: false, errorKind, ...(status ? { status } : {}) });

/** Fetches bounded pages, normalises provider model ids, and never follows a server-supplied URL. */
async function listAiModels(raw, { customFetch, timeoutMs = 30_000 } = {}) {
    const checked = validateAiConnectionTestInput({ ...raw, model: undefined });
    if (checked.error) return failure('invalid');
    const config = checked.config;
    if (!config.apiKey) return failure('config');
    const url = modelListUrl(config);
    const signal = AbortSignal.timeout(timeoutMs);
    const headers = config.provider === 'gemini' ? { 'x-goog-api-key': config.apiKey }
        : config.apiProtocol === 'anthropic' ? anthropicHeaders(config.apiKey)
            : { Authorization: 'Bearer ' + config.apiKey };
    const models = new Map();
    const cursors = new Set();
    try {
        for (let page = 0; page < MAX_PAGES; page += 1) {
            const response = await customFetch(url.toString(), { method: 'GET', headers, signal, redirect: 'error' });
            if (!response.ok) return failure(response.status === 401 || response.status === 403 ? 'auth' : 'http', response.status);
            const data = await readCatalogue(response);
            if (!data || typeof data !== 'object') return failure('invalid');
            const rows = config.provider === 'gemini' ? data.models : data.data ?? data.rows;
            if (!Array.isArray(rows)) return failure('invalid');
            for (const row of rows) {
                if (!row || typeof row !== 'object') continue;
                if (config.provider === 'gemini' && (!Array.isArray(row.supportedGenerationMethods) || !row.supportedGenerationMethods.includes('generateContent'))) continue;
                const rawId = config.provider === 'gemini' ? row.name : row.id ?? row.modelCode;
                const id = typeof rawId === 'string' ? rawId.replace(/^models\//, '').trim() : '';
                if (!id || id.length > 256 || /[\u0000-\u001f]/.test(id)) continue;
                if (config.provider === 'gemini' && !/^[\w.-]+$/.test(id)) continue;
                const name = row.display_name ?? row.displayName ?? row.modelName ?? id;
                models.set(id, { id, name: typeof name === 'string' ? name.slice(0, 256) : id });
                if (models.size > MAX_MODELS) return failure('invalid');
            }
            let cursor = null;
            if (config.provider === 'gemini' && data.nextPageToken) {
                cursor = String(data.nextPageToken);
                url.searchParams.set('pageToken', cursor);
            } else if (data.has_more === true) {
                cursor = data.last_id ?? rows.at(-1)?.id;
                if (typeof cursor !== 'string' || !cursor) return failure('invalid');
                url.searchParams.set(config.apiProtocol === 'anthropic' ? 'after_id' : 'after', cursor);
            } else if (Array.isArray(data.rows) && Number.isFinite(data.total) && (page + 1) * 100 < data.total) {
                cursor = String(page + 2);
                url.searchParams.set('pageNum', cursor);
            }
            if (cursor === null) {
                return models.size ? { ok: true, models: [...models.values()] } : failure('empty');
            }
            if (cursors.has(cursor) || page === MAX_PAGES - 1) return failure('invalid');
            cursors.add(cursor);
        }
    } catch (error) {
        return failure(signal.aborted ? 'timeout' : error instanceof SyntaxError || error instanceof RangeError ? 'invalid' : 'network');
    }
    return failure('invalid');
}

module.exports = { listAiModels, modelListUrl };

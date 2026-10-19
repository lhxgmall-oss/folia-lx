const { createQishuiApi, QISHUI_OPERATIONS } = require('qishui-music-api');
const { createSessionRepository } = require('./session.cjs');

// Electron owns persistence, the IPC allowlist and media registration; the package owns the protocol.
function createQishuiApiBridge({ store, safeStorage, fetch, log = console.info, warn = console.warn,
    onAudioSource = () => {}, apiFactory = createQishuiApi }) {
    const sessions = createSessionRepository({ store, safeStorage, warn });
    const api = apiFactory({ deviceId: sessions.deviceId, sessions, fetch, log });
    return {
        async request(operation, params = {}) {
            try {
                if (!QISHUI_OPERATIONS.includes(operation)) {
                    return { ok: false, error: { code: 'unsupported', message: 'Unsupported Qishui operation' } };
                }
                const result = await api.request(operation, params);
                if (result.ok && operation === 'audio' && result.data?.url) onAudioSource(result.data.url);
                return result;
            } catch {
                return { ok: false, error: { code: 'invalid-response', message: 'Qishui operation failed' } };
            }
        },
    };
}
module.exports = { createQishuiApiBridge };

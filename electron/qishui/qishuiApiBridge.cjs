const { createSessionRepository, isAccountId } = require('./session.cjs');
const { createClient, QishuiError } = require('./client.cjs');
const { createAuth } = require('./auth.cjs');
const { createCatalog, publicTrack } = require('./catalog.cjs');
const { createFeed } = require('./feed.cjs');
const { resolveAudio } = require('./playback.cjs');

// Whitelisted car operations; renderer callers cannot supply a host, raw request, token or key.
const OPERATIONS = ['login_status', 'logout', 'login_qr_key', 'login_qr_create', 'login_qr_check', 'login_qr_cancel',
    'search', 'search_playlists', 'song_detail', 'audio', 'lyrics', 'user_playlists', 'playlist_detail', 'playlist_tracks',
    'artist_detail', 'artist_songs', 'feed', 'feed_modes'];
const idOf = value => {
    if (typeof value !== 'string' || !/^\d{1,30}$/.test(value)) throw new QishuiError('invalid-response', 'Invalid Qishui media ID');
    return value;
};
function createQishuiApiBridge(options) {
    const sessions = createSessionRepository(options);
    const client = createClient({ sessions, fetch: options.fetch });
    const auth = createAuth(client, options);
    const catalog = createCatalog(client);
    const feed = createFeed(client);
    const nowUser = () => sessions.get()?.userId || null;
    return {
        async request(operation, raw = {}) {
            try {
                if (!OPERATIONS.includes(operation)) throw new QishuiError('unsupported', 'Unsupported Qishui operation');
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new QishuiError('invalid-response', 'Invalid Qishui parameters');
                const limit = Math.min(raw.limit ?? 30, 100);
                const offset = raw.offset ?? 0;
                if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(offset) || offset < 0 || offset > 50000) throw new QishuiError('invalid-response', 'Invalid Qishui page');
                const p = { limit, offset };
                if (['song_detail', 'audio', 'lyrics', 'playlist_detail', 'playlist_tracks', 'artist_detail', 'artist_songs'].includes(operation)) p.id = idOf(raw.id);
                if (raw.ownerId && !isAccountId(raw.ownerId)) throw new QishuiError('invalid-response', 'Invalid Qishui owner ID');
                if (operation.startsWith('search')) {
                    if (typeof raw.query !== 'string' || raw.query.length > 500) throw new QishuiError('invalid-response', 'Invalid Qishui search');
                    p.query = raw.query.trim();
                }
                if (operation.startsWith('login_qr_') && operation !== 'login_qr_key'
                    && (typeof raw.key !== 'string' || !/^[a-f0-9]{32}$/.test(raw.key))) throw new QishuiError('invalid-response', 'Invalid QR key');
                let data;
                const userId = nowUser();
                switch (operation) {
                    case 'login_qr_key': data = await auth.start(); break;
                    case 'login_qr_create': data = auth.qr(raw.key); break;
                    case 'login_qr_check': data = await auth.check(raw.key); break;
                    case 'login_qr_cancel': auth.cancel(raw.key); data = null; break;
                    case 'login_status': data = await auth.status(); break;
                    case 'logout': auth.logout(); feed.clear(); data = null; break;
                    case 'song_detail': data = publicTrack(await catalog.track(p.id)); break;
                    case 'lyrics': data = (await catalog.track(p.id)).display_info?.lyric_info || {}; break;
                    case 'audio': {
                        if (!['standard', 'high', 'lossless', 'hires'].includes(raw.quality)) throw new QishuiError('invalid-response', 'Invalid Qishui audio quality');
                        data = await resolveAudio(client, await catalog.track(p.id), raw.quality, options.onAudioSource);
                        break;
                    }
                    case 'playlist_detail': case 'playlist_tracks':
                        data = await catalog.playlist_tracks({ ...p, ownerId: raw.ownerId || '' });
                        if (operation === 'playlist_detail') data = data.collection || null;
                        break;
                    case 'feed_modes': data = await feed.modes(); break;
                    case 'feed': data = await feed.songs({ scene: raw.scene, preference: raw.preference,
                        queue: raw.queue === 'explore' ? 'explore' : 'fm', first: raw.first === true, count: limit }); break;
                    default:
                        data = p.query === '' ? { items: [], hasMore: false, nextOffset: offset } : await catalog[operation](p);
                }
                if (!['logout', 'login_status', 'login_qr_check'].includes(operation) && nowUser() !== userId) throw new QishuiError('unavailable', 'Qishui account changed during the request');
                return { ok: true, data };
            } catch (error) {
                // Only safe protocol errors cross IPC. Fetch exceptions may embed credential-bearing URLs.
                if (error instanceof QishuiError && operation.startsWith('login')) console.warn('[Qishui] Sign-in operation failed', error);
                if (error instanceof QishuiError) return { ok: false, error: { code: error.code, message: error.message, upstreamCode: error.upstreamCode, stage: error.stage } };
                return { ok: false, error: { code: 'invalid-response', message: 'Qishui operation failed' } };
            }
        },
    };
}
module.exports = { createQishuiApiBridge, OPERATIONS };

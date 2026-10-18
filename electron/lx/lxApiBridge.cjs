const { SUB_SOURCES, LX_QUALITIES } = require('./userApi/userApiManager.cjs');
const { parseLxListFile } = require('./myLists/lxListFile.cjs');
const { createLxCoverFill } = require('./myLists/lxCoverFill.cjs');

// electron/lx/lxApiBridge.cjs
// The one main-process entry for the LX provider: request(operation, params) answers
// { ok: true, data } or { ok: false, error: { code, message } } like the other desktop bridges.
// Search, song lists, lyrics and covers come from the vendored LX musicSdk (./musicSdk); a song's
// playable URL comes from the listener's custom source script (./userApi).

const LX_OPERATIONS = Object.freeze([
  'state', 'search', 'songlist_hot', 'songlist_detail', 'songlist_search', 'lyric', 'pic', 'music_url',
  'script_import_text', 'script_import_url', 'script_import_file', 'script_remove', 'script_activate', 'settings_set',
  'mylists', 'mylist_tracks', 'mylist_import_file', 'mylist_remove', 'mylist_cover_status',
]);

// Folia's levels, lowest first, and the LX quality each one asks for.
const FOLIA_TO_LX_QUALITY = Object.freeze({ standard: '128k', high: '320k', ultra: '320k', lossless: 'flac', hires: 'flac24bit' });
const LX_TO_FOLIA_QUALITY = Object.freeze({ '128k': 'standard', '320k': 'high', flac: 'lossless', flac24bit: 'hires' });

const NETWORK_ERROR_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);
const isSubSource = value => SUB_SOURCES.includes(value);
const clampInt = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const fail = (code, message) => ({ ok: false, error: { code, message: String(message || code) } });

const songQualities = musicInfo => {
  const types = Array.isArray(musicInfo?.types) ? musicInfo.types.map(type => type?.type) : Object.keys(musicInfo?._types || {});
  return types.filter(type => LX_QUALITIES.includes(type));
};

/**
 * The quality to ask the script for: the highest one at or below `wanted` that both the script
 * declared for this sub-source and the song lists (where the song lists any); otherwise the lowest
 * one the script declared.
 */
function pickQuality(wanted, scriptQualities, songTypes) {
  const declared = (scriptQualities || []).filter(q => LX_QUALITIES.includes(q));
  if (!declared.length) return null;
  const ceiling = Math.max(0, LX_QUALITIES.indexOf(wanted));
  for (let index = ceiling; index >= 0; index -= 1) {
    const quality = LX_QUALITIES[index];
    if (declared.includes(quality) && (!songTypes.length || songTypes.includes(quality))) return quality;
  }
  return declared.find(q => LX_QUALITIES.indexOf(q) <= ceiling) || declared[0];
}

// Interleaves several result lists: a1, b1, c1, a2, b2, ...
const interleave = lists => {
  const out = [];
  const longest = Math.max(0, ...lists.map(list => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of lists) if (index < list.length) out.push(list[index]);
  }
  return out;
};

// kw and kg search rows carry no cover. Asks for the missing ones, a few at a time, and gives up on
// whatever is not back within `budgetMs`: a row without a cover is shown with the placeholder.
async function fillCovers(sdk, rows, { budgetMs = 2500, max = 40, concurrency = 6 } = {}) {
  const missing = rows.filter(row => row && !row.img && sdk.sources[row.source]?.getPic).slice(0, max);
  if (!missing.length) return rows;
  let next = 0;
  const worker = async () => {
    while (next < missing.length) {
      const row = missing[next++];
      try {
        const url = await sdk.sources[row.source].getPic(row);
        if (typeof url === 'string' && /^https?:/.test(url)) row.img = url;
      } catch {}
    }
  };
  const workers = Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker));
  await Promise.race([workers, new Promise(resolve => setTimeout(resolve, budgetMs).unref?.())]);
  return rows;
}

function createLxApiBridge({ sdk, request, manager, myLists = null, pickScriptFile = async () => null, pickListFile = async () => null, log = console }) {
  sdk.setRequester(request);

  // Covers of imported songs, asked of the sub-source's musicSdk getPic in the background.
  const coverFill = myLists ? createLxCoverFill({
    myLists,
    getPic: row => {
      // tx builds the URL from the album id alone: without one it would be a dead link.
      if (row.source === 'tx' && !row.albumId) {
        if (!row.albumMid) return null;
        row = { ...row, albumId: row.albumMid };
      }
      return sdk.sources[row.source]?.getPic?.(row);
    },
    log,
  }) : null;
  let coverFillAsked = false;

  const requireMyLists = () => {
    if (!myLists) throw Object.assign(new Error('Imported LX lists are not available here'), { code: 'unsupported' });
    return myLists;
  };

  const sourceOf = value => {
    if (!isSubSource(value)) throw Object.assign(new Error(`Unknown LX sub-source: ${value}`), { code: 'unsupported' });
    return sdk.sources[value];
  };

  async function searchOne(source, query, page, limit) {
    const result = await sourceOf(source).musicSearch.search(query, page, limit);
    // Rows are copied: the musicSdk modules keep no reference, but the covers are written into them.
    return { source, list: Array.isArray(result?.list) ? result.list.map(row => ({ ...row })) : [], total: Number(result?.total) || 0, allPage: Number(result?.allPage) || 0 };
  }

  // Songs from one sub-source, or from all of them ("all"): each sub-source is asked for its share of
  // the page and the answers are interleaved. A sub-source that fails is left out; all failing fails.
  async function search({ query, page = 1, limit = 30, subSource }) {
    const text = String(query || '').trim();
    const wanted = subSource || manager.getSettings().subSource;
    const safePage = clampInt(page, 1, 1000, 1);
    const safeLimit = clampInt(limit, 1, 100, 30);
    if (!text) return { list: [], total: 0, hasMore: false, sources: [] };
    if (wanted !== 'all') {
      const one = await searchOne(wanted, text, safePage, safeLimit);
      await fillCovers(sdk, one.list);
      return { list: one.list, total: one.total, hasMore: safePage < one.allPage, sources: [{ source: wanted, ok: true, total: one.total }] };
    }
    const share = Math.max(1, Math.ceil(safeLimit / SUB_SOURCES.length));
    const settled = await Promise.allSettled(SUB_SOURCES.map(source => searchOne(source, text, safePage, share)));
    const ok = settled.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (!ok.length) {
      const first = settled.find(result => result.status === 'rejected');
      throw first?.reason || new Error('Every LX sub-source failed');
    }
    settled.forEach((result, index) => {
      if (result.status === 'rejected') log.warn?.(`[LX] search: ${SUB_SOURCES[index]} failed`, result.reason);
    });
    // Some sub-sources (mg) answer more rows than asked for; each keeps its share.
    const list = await fillCovers(sdk, interleave(ok.map(one => one.list.slice(0, share))));
    return {
      list,
      total: ok.reduce((sum, one) => sum + one.total, 0),
      hasMore: ok.some(one => safePage < one.allPage),
      sources: settled.map((result, index) => ({
        source: SUB_SOURCES[index],
        ok: result.status === 'fulfilled',
        ...(result.status === 'fulfilled' ? { total: result.value.total } : { message: String(result.reason?.message || result.reason) }),
      })),
    };
  }

  async function urlFor(source, musicInfo, wantedLx, sources) {
    const declared = sources[source];
    if (!declared || !declared.actions.includes('musicUrl')) {
      throw Object.assign(new Error(`The source script does not cover ${source}`), { code: 'not-playable' });
    }
    const quality = pickQuality(wantedLx, declared.qualitys, songQualities(musicInfo));
    if (!quality) throw Object.assign(new Error(`The source script lists no quality for ${source}`), { code: 'not-playable' });
    const data = await manager.ask(source, 'musicUrl', { type: quality, musicInfo });
    return { url: data.url, lxQuality: quality };
  }

  // The song's URL from the script; where that fails and fallback is on, the same song found on the
  // other sub-sources the script covers (LX's "换源": search by name and singer, best match first).
  async function musicUrl({ source, musicInfo, quality, allowFallback = true }) {
    sourceOf(source);
    if (!musicInfo || typeof musicInfo !== 'object') throw Object.assign(new Error('musicInfo is required'), { code: 'invalid-response' });
    const settings = manager.getSettings();
    const wantedLx = settings.quality !== 'follow' ? settings.quality : (FOLIA_TO_LX_QUALITY[quality] || '320k');
    const sources = await manager.declaredSources();
    if (!Object.keys(sources).length) {
      const state = manager.getState();
      throw Object.assign(new Error(state.status.message || 'No LX source script is imported or active'), { code: 'unavailable' });
    }
    try {
      const got = await urlFor(source, musicInfo, wantedLx, sources);
      return { ...got, quality: LX_TO_FOLIA_QUALITY[got.lxQuality], source, musicInfo };
    } catch (firstError) {
      if (!allowFallback || !settings.fallback) throw firstError;
      const others = SUB_SOURCES.filter(other => other !== source && sources[other]?.actions.includes('musicUrl'));
      if (!others.length) throw firstError;
      log.info?.(`[LX] music_url: ${source} failed, trying ${others.join(',')}`, { message: firstError?.message });
      const query = `${musicInfo.name || ''} ${musicInfo.singer || ''}`.trim();
      const lists = (await Promise.allSettled(others.map(other => searchOne(other, query, 1, 10))))
        .filter(result => result.status === 'fulfilled').map(result => result.value);
      const candidates = sdk.pickMatches({
        name: musicInfo.name, singer: musicInfo.singer, albumName: musicInfo.albumName, interval: musicInfo.interval,
      }, lists).slice(0, 4);
      for (const candidate of candidates) {
        try {
          const got = await urlFor(candidate.source, candidate, wantedLx, sources);
          log.info?.(`[LX] music_url: fell back from ${source} to ${candidate.source}`);
          return { ...got, quality: LX_TO_FOLIA_QUALITY[got.lxQuality], source: candidate.source, musicInfo: candidate, fallbackFrom: source };
        } catch (error) {
          log.warn?.(`[LX] music_url: fallback ${candidate.source} failed`, error);
        }
      }
      throw firstError;
    }
  }

  const handlers = {
    state: () => manager.getState(),
    search,
    async songlist_hot({ source, page = 1, sortId, tagId = '' }) {
      const songList = sourceOf(source).songList;
      const sort = sortId || songList.sortList?.[0]?.id;
      const result = await songList.getList(sort, tagId, clampInt(page, 1, 1000, 1));
      return { list: result?.list || [], total: Number(result?.total) || 0, page: Number(result?.page) || page, limit: Number(result?.limit) || 0, source };
    },
    async songlist_detail({ source, id, page = 1 }) {
      if (id == null || id === '') throw Object.assign(new Error('Song list id is required'), { code: 'invalid-response' });
      const result = await sourceOf(source).songList.getListDetail(String(id), clampInt(page, 1, 1000, 1));
      const list = await fillCovers(sdk, (result?.list || []).map(row => ({ ...row })));
      return { list, total: Number(result?.total) || 0, page: Number(result?.page) || page, limit: Number(result?.limit) || 0, info: result?.info || {}, source };
    },
    async songlist_search({ source, query, page = 1, limit = 20 }) {
      const result = await sourceOf(source).songList.search(String(query || ''), clampInt(page, 1, 1000, 1), clampInt(limit, 1, 100, 20));
      return { list: result?.list || [], total: Number(result?.total) || 0, source };
    },
    async lyric({ source, musicInfo }) {
      const result = await sourceOf(source).getLyric(musicInfo);
      return { lyric: String(result?.lyric || ''), tlyric: result?.tlyric || '', rlyric: result?.rlyric || '', lxlyric: result?.lxlyric || '' };
    },
    async pic({ source, musicInfo }) {
      return { url: (await sourceOf(source).getPic(musicInfo)) || null };
    },
    music_url: musicUrl,
    script_import_text: ({ script }) => manager.importScript(script),
    script_import_url: ({ url }) => manager.importFromUrl(url),
    async script_import_file() {
      const text = await pickScriptFile();
      return text == null ? null : manager.importScript(text);
    },
    script_remove: ({ id }) => manager.remove(String(id)),
    script_activate: ({ id }) => manager.activate(id == null ? null : String(id)),
    settings_set: patch => manager.setSettings(patch),
    // The lists imported from LX Music desktop's 「我的列表」 (./myLists).
    mylists: () => {
      const lists = requireMyLists().list();
      // The first read in a run of the app goes on with covers an earlier run did not finish.
      if (!coverFillAsked && lists.length) {
        coverFillAsked = true;
        void coverFill.start();
      }
      return lists;
    },
    mylist_cover_status: () => (coverFill ? coverFill.status() : { running: false, done: 0, total: 0, filled: 0 }),
    mylist_tracks: ({ key, offset, limit }) => requireMyLists().tracks({ key: String(key || ''), offset, limit }),
    async mylist_import_file() {
      const store = requireMyLists();
      const file = await pickListFile();
      if (file == null) return null;
      const parsed = parseLxListFile(file);
      const result = store.importLists(parsed);
      coverFillAsked = true;
      void coverFill.start(); // not waited for: the import answers now
      log.info?.(`[LX] my lists: imported ${result.lists} lists (${result.updated} replaced), ${result.songs} songs; left out ${result.skippedLocal} local and ${result.skippedOther} other songs, ${result.emptyLists} empty lists (${parsed.type})`);
      return { ...result, type: parsed.type };
    },
    mylist_remove: ({ key }) => requireMyLists().remove(String(key || '')),
  };

  return {
    async request(operation, params = {}) {
      if (!LX_OPERATIONS.includes(operation)) return fail('unsupported', 'Unsupported LX operation');
      try {
        const data = await handlers[operation](params && typeof params === 'object' ? params : {});
        return { ok: true, data: data === undefined ? null : data };
      } catch (error) {
        const raw = typeof error?.code === 'string' ? error.code : '';
        const code = ['unsupported', 'unavailable', 'not-playable', 'network', 'invalid-response'].includes(raw) ? raw
          : NETWORK_ERROR_CODES.has(raw) ? 'network' : 'invalid-response';
        return fail(code, error?.message || error);
      }
    },
  };
}

module.exports = { createLxApiBridge, fillCovers, pickQuality, interleave, LX_OPERATIONS, FOLIA_TO_LX_QUALITY, LX_TO_FOLIA_QUALITY };

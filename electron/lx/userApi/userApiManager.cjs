const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseScriptInfo } = require('./scriptRuntime.cjs');

// electron/lx/userApi/userApiManager.cjs
// Keeps the custom source scripts the listener imported (userData/lx-user-api/), which one is in use,
// the LX settings (sub-source filter, quality, fallback), and the process the script in use runs in
// (./scriptHost.cjs). Folia-LX ships no script: everything here comes from the listener's own import.

const MAX_SCRIPT_BYTES = 9 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const SUB_SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg'];
const LX_QUALITIES = ['128k', '320k', 'flac', 'flac24bit'];
const DEFAULT_SETTINGS = Object.freeze({ subSource: 'all', quality: 'follow', fallback: true });

const sanitizeSettings = raw => {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    subSource: value.subSource === 'all' || SUB_SOURCES.includes(value.subSource) ? value.subSource : DEFAULT_SETTINGS.subSource,
    quality: value.quality === 'follow' || LX_QUALITIES.includes(value.quality) ? value.quality : DEFAULT_SETTINGS.quality,
    fallback: typeof value.fallback === 'boolean' ? value.fallback : DEFAULT_SETTINGS.fallback,
  };
};

/**
 * `baseDir()`: where scripts are kept (created on first write).
 * `spawnHost()`: starts ./scriptHost.cjs and answers { postMessage(msg), onMessage(fn), onExit(fn), kill() }.
 * `fetchText(url)`: GETs a script for import-from-URL.
 */
function createUserApiManager({ baseDir, spawnHost, fetchText, log = console, now = Date.now }) {
  let state = null; // { apis, activeId, settings }
  let host = null; // { channel, ready: Promise<sources>, pending: Map, apiId }
  let status = { state: 'idle', message: '', sources: {} };
  let nextRequestId = 1;

  const dir = () => baseDir();
  const indexPath = () => path.join(dir(), 'index.json');
  const scriptPath = id => path.join(dir(), 'scripts', `${id}.js`);

  const load = () => {
    if (state) return state;
    try {
      const raw = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
      state = {
        apis: Array.isArray(raw.apis) ? raw.apis.filter(api => api && typeof api.id === 'string' && /^[\w-]+$/.test(api.id)) : [],
        activeId: typeof raw.activeId === 'string' ? raw.activeId : null,
        settings: sanitizeSettings(raw.settings),
      };
    } catch {
      state = { apis: [], activeId: null, settings: { ...DEFAULT_SETTINGS } };
    }
    if (state.activeId && !state.apis.some(api => api.id === state.activeId)) state.activeId = null;
    return state;
  };

  const save = () => {
    fs.mkdirSync(dir(), { recursive: true });
    const tmp = `${indexPath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, indexPath());
  };

  const stopHost = () => {
    if (!host) return;
    const old = host;
    host = null;
    for (const { reject, timer } of old.pending.values()) {
      clearTimeout(timer);
      reject(new Error('The source script was unloaded'));
    }
    try { old.channel.kill(); } catch {}
  };

  const startHost = () => {
    const { activeId } = load();
    if (!activeId) {
      status = { state: 'idle', message: '', sources: {} };
      return null;
    }
    if (host && host.apiId === activeId) return host;
    stopHost();
    let script;
    try {
      script = fs.readFileSync(scriptPath(activeId), 'utf8');
    } catch (error) {
      status = { state: 'error', message: `Script file is missing: ${error.message}`, sources: {} };
      return null;
    }
    const channel = spawnHost();
    const current = { channel, apiId: activeId, pending: new Map(), ready: null };
    status = { state: 'loading', message: '', sources: {} };
    current.ready = new Promise((resolve, reject) => {
      channel.onMessage(message => {
        if (host !== current || !message) return;
        if (message.type === 'inited') {
          if (message.ok) {
            status = { state: 'ready', message: '', sources: message.sources || {} };
            log.info?.('[LX] source script ready', { sources: Object.keys(message.sources || {}) });
            resolve(message.sources || {});
          } else {
            status = { state: 'error', message: message.message || 'Script failed', sources: {} };
            log.warn?.('[LX] source script failed to init', { message: message.message });
            reject(new Error(message.message || 'Script failed'));
          }
        } else if (message.type === 'response') {
          const entry = current.pending.get(message.id);
          if (!entry) return;
          current.pending.delete(message.id);
          clearTimeout(entry.timer);
          if (message.ok) entry.resolve(message.data);
          else entry.reject(new Error(message.message || 'Script request failed'));
        } else if (message.type === 'log') {
          (log[message.level] || log.log)?.call(log, `[LX] script: ${message.message}`);
        } else if (message.type === 'updateAlert') {
          status = { ...status, updateAlert: { log: message.log, updateUrl: message.updateUrl } };
        }
      });
      channel.onExit(code => {
        if (host !== current) return;
        host = null;
        const error = new Error(`The source script process exited (${code})`);
        if (status.state !== 'error') status = { state: 'error', message: error.message, sources: {} };
        for (const entry of current.pending.values()) {
          clearTimeout(entry.timer);
          entry.reject(error);
        }
        reject(error);
      });
    });
    current.ready.catch(() => {});
    host = current;
    channel.postMessage({ type: 'load', script });
    return current;
  };

  // Asks the script in use; starts its process first where needed.
  async function ask(source, action, info) {
    const current = startHost();
    if (!current) throw Object.assign(new Error('No LX source script is imported or active'), { code: 'unavailable' });
    const sources = await current.ready;
    const declared = sources[source];
    if (!declared || !declared.actions.includes(action)) {
      throw Object.assign(new Error(`The source script does not support ${action} for ${source}`), { code: 'not-playable' });
    }
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        current.pending.delete(id);
        reject(Object.assign(new Error('The source script did not answer in time'), { code: 'network' }));
      }, REQUEST_TIMEOUT_MS);
      timer.unref?.();
      current.pending.set(id, { resolve, reject, timer });
      current.channel.postMessage({ type: 'request', id, source, action, info });
    });
  }

  function importScript(script) {
    const text = String(script || '');
    if (!text.trim()) throw new Error('The script is empty');
    if (Buffer.byteLength(text) > MAX_SCRIPT_BYTES) throw new Error('The script is too large');
    const info = parseScriptInfo(text);
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const current = load();
    const duplicate = current.apis.find(api => api.hash === hash);
    if (duplicate) throw new Error(`导入失败，脚本内容与已有的源「${duplicate.name}」相同`);
    const id = `user_api_${crypto.randomBytes(3).toString('hex')}_${now()}`;
    fs.mkdirSync(path.dirname(scriptPath(id)), { recursive: true });
    fs.writeFileSync(scriptPath(id), text);
    const api = { id, ...info, hash, importedAt: now() };
    current.apis.push(api);
    if (!current.activeId) current.activeId = id;
    save();
    log.info?.('[LX] imported a source script', { id, name: info.name, version: info.version });
    if (current.activeId === id) startHost();
    const { hash: _hash, ...shown } = api;
    return shown;
  }

  async function importFromUrl(url) {
    let parsed;
    try { parsed = new URL(String(url)); } catch { throw new Error('Not a valid URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http(s) URLs can be imported');
    const text = await fetchText(parsed.href, MAX_SCRIPT_BYTES);
    return importScript(text);
  }

  function remove(id) {
    const current = load();
    const index = current.apis.findIndex(api => api.id === id);
    if (index < 0) return false;
    current.apis.splice(index, 1);
    try { fs.rmSync(scriptPath(id), { force: true }); } catch {}
    if (current.activeId === id) {
      stopHost();
      current.activeId = current.apis[0]?.id || null;
    }
    save();
    if (current.activeId) startHost();
    else status = { state: 'idle', message: '', sources: {} };
    return true;
  }

  function activate(id) {
    const current = load();
    if (id !== null && !current.apis.some(api => api.id === id)) throw new Error('No such script');
    current.activeId = id;
    save();
    stopHost();
    if (id) startHost();
    else status = { state: 'idle', message: '', sources: {} };
  }

  function setSettings(patch) {
    const current = load();
    current.settings = sanitizeSettings({ ...current.settings, ...(patch || {}) });
    save();
    return current.settings;
  }

  function getState() {
    const current = load();
    return {
      apis: current.apis.map(({ hash, ...api }) => api),
      activeId: current.activeId,
      settings: { ...current.settings },
      status: { ...status },
    };
  }

  return {
    getState,
    getSettings: () => ({ ...load().settings }),
    importScript,
    importFromUrl,
    remove,
    activate,
    setSettings,
    ask,
    /** The sources the active script declared, waiting for it to load; {} without one. */
    async declaredSources() {
      const current = startHost();
      if (!current) return {};
      try { return await current.ready; } catch { return {}; }
    },
    reload() {
      stopHost();
      startHost();
    },
    dispose: stopHost,
  };
}

module.exports = { createUserApiManager, sanitizeSettings, SUB_SOURCES, LX_QUALITIES, DEFAULT_SETTINGS };

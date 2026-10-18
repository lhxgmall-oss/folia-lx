const vm = require('node:vm');
const zlib = require('node:zlib');
const { createCipheriv, publicEncrypt, constants, randomBytes, createHash } = require('node:crypto');

// electron/lx/userApi/scriptRuntime.cjs
// Runs one LX Music custom source script ("自定义源") in its own vm context with the `lx` global
// that lx-music-desktop gives it (src/main/modules/userApi/renderer/preload.js, API version 2.0.0):
// lx.EVENT_NAMES, lx.on('request'), lx.send('inited' | 'updateAlert'), lx.request, lx.utils.
// The context gets browser-like globals only: no require, no process, no Node modules. It runs inside
// a separate process (./scriptHost.cjs), which is where the isolation actually comes from; a vm context
// alone is not a security boundary.

const EVENT_NAMES = Object.freeze({ request: 'request', inited: 'inited', updateAlert: 'updateAlert' });
const ALL_SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg', 'local'];
const SUPPORT_QUALITYS = {
  kw: ['128k', '320k', 'flac', 'flac24bit'],
  kg: ['128k', '320k', 'flac', 'flac24bit'],
  tx: ['128k', '320k', 'flac', 'flac24bit'],
  wy: ['128k', '320k', 'flac', 'flac24bit'],
  mg: ['128k', '320k', 'flac', 'flac24bit'],
  local: [],
};
const SUPPORT_ACTIONS = {
  kw: ['musicUrl'], kg: ['musicUrl'], tx: ['musicUrl'], wy: ['musicUrl'], mg: ['musicUrl'],
  local: ['musicUrl', 'lyric', 'pic'],
};

// Header comment of a script: /* @name ... @description ... @version ... @author ... @homepage ... */
const INFO_LIMITS = { name: 24, description: 36, author: 56, homepage: 1024, version: 36 };
function parseScriptInfo(script) {
  const result = /^\/\*[\S|\s]+?\*\//.exec(String(script || ''));
  if (!result) throw new Error('无效的自定义源文件：开头缺少 /* @name ... */ 注释');
  const infos = {};
  for (const line of result[0].split(/\r?\n/)) {
    const match = /^\s?\*\s?@(\w+)\s(.+)$/.exec(line);
    if (!match || INFO_LIMITS[match[1]] == null) continue;
    infos[match[1]] = match[2].trim();
  }
  for (const [key, len] of Object.entries(INFO_LIMITS)) {
    infos[key] ||= '';
    if (infos[key].length > len) infos[key] = `${infos[key].substring(0, len)}...`;
  }
  infos.name ||= `user_api_${new Date().toISOString()}`;
  return infos;
}

const verifyLyricInfo = info => {
  if (typeof info != 'object' || typeof info.lyric != 'string') throw new Error('failed');
  if (info.lyric.length > 51200) throw new Error('failed');
  return {
    lyric: info.lyric,
    tlyric: (typeof info.tlyric == 'string' && info.tlyric.length < 5120) ? info.tlyric : null,
    rlyric: (typeof info.rlyric == 'string' && info.rlyric.length < 5120) ? info.rlyric : null,
    lxlyric: (typeof info.lxlyric == 'string' && info.lxlyric.length < 8192) ? info.lxlyric : null,
  };
};

const isUrl = value => typeof value == 'string' && value.length <= 2048 && /^https?:/.test(value);

// What the script declared in lx.send('inited', { sources }), cut down to what LX itself accepts.
function normalizeSources(info) {
  if (!info || typeof info !== 'object') throw new Error('Missing required parameter init info');
  const sources = {};
  for (const source of ALL_SOURCES) {
    const userSource = info.sources?.[source];
    if (!userSource || userSource.type !== 'music') continue;
    sources[source] = {
      type: 'music',
      actions: SUPPORT_ACTIONS[source].filter(action => (userSource.actions || []).includes(action)),
      qualitys: SUPPORT_QUALITYS[source].filter(quality => (userSource.qualitys || []).includes(quality)),
    };
  }
  return sources;
}

/**
 * Loads `script`. `request(url, options)` answers { promise, abort } like ../lxHttp.cjs.
 * Returns { ready, handle, info }: `ready` resolves to the declared sources once the script calls
 * lx.send('inited'), or rejects with the script's error; `handle({ source, action, info })` asks it.
 */
function createLxRuntime({ script, request, log = () => {}, onUpdateAlert = () => {}, initTimeoutMs = 20_000 }) {
  const scriptInfo = parseScriptInfo(script);
  let requestHandler = null;
  let inited = false;
  let updateAlertShown = false;
  let settle;
  const ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const failInit = message => {
    if (inited) return;
    inited = true;
    const text = String(message || 'Script failed');
    settle.reject(new Error(text.length > 1024 ? `${text.substring(0, 1024)}...` : text));
  };
  const timer = setTimeout(() => failInit('Script did not call lx.send("inited") in time'), initTimeoutMs);
  timer.unref?.();

  const lx = {
    EVENT_NAMES,
    request(url, { method = 'get', timeout, headers, body, form, formData } = {}, callback) {
      const { promise, abort } = request(String(url), {
        method, headers, body, form, formData,
        timeout: typeof timeout == 'number' && timeout > 0 ? Math.min(timeout, 60_000) : 60_000,
      });
      promise.then(resp => {
        callback?.call(lx, null, {
          statusCode: resp.statusCode,
          statusMessage: resp.statusMessage,
          headers: resp.headers,
          bytes: resp.bytes,
          raw: resp.raw,
          body: resp.body,
        }, resp.body);
      }, error => {
        callback?.call(lx, error, null, null);
      }).catch(error => log('warn', `callback threw: ${error?.message || error}`));
      return () => abort();
    },
    send(eventName, data) {
      return new Promise((resolve, reject) => {
        switch (eventName) {
          case EVENT_NAMES.inited: {
            if (inited) return reject(new Error('Script is inited'));
            try {
              const sources = normalizeSources(data);
              inited = true;
              clearTimeout(timer);
              settle.resolve(sources);
              resolve();
            } catch (error) {
              failInit(error.message);
              reject(error);
            }
            break;
          }
          case EVENT_NAMES.updateAlert: {
            if (updateAlertShown) return reject(new Error('The update alert can only be called once.'));
            if (!data || typeof data != 'object' || typeof data.log != 'string' || !data.log) return reject(new Error('log is required.'));
            updateAlertShown = true;
            onUpdateAlert({
              log: data.log.length > 1024 ? `${data.log.substring(0, 1024)}...` : data.log,
              updateUrl: typeof data.updateUrl === 'string' && /^https?:\/\//.test(data.updateUrl) && data.updateUrl.length <= 1024 ? data.updateUrl : undefined,
            });
            resolve();
            break;
          }
          default:
            reject(new Error(`The event is not supported: ${eventName}`));
        }
      });
    },
    on(eventName, handler) {
      if (eventName !== EVENT_NAMES.request) return Promise.reject(new Error(`The event is not supported: ${eventName}`));
      requestHandler = handler;
      return Promise.resolve();
    },
    utils: {
      crypto: {
        aesEncrypt(buffer, mode, key, iv) {
          const cipher = createCipheriv(mode, key, iv);
          return Buffer.concat([cipher.update(buffer), cipher.final()]);
        },
        rsaEncrypt(buffer, key) {
          buffer = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer]);
          return publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, buffer);
        },
        randomBytes(size) { return randomBytes(size); },
        md5(str) { return createHash('md5').update(str).digest('hex'); },
      },
      buffer: {
        from(...args) { return Buffer.from(...args); },
        bufToString(buf, format) { return Buffer.from(buf, 'binary').toString(format); },
      },
      zlib: {
        inflate(buf) {
          return new Promise((resolve, reject) => zlib.inflate(buf, (err, data) => (err ? reject(new Error(err.message)) : resolve(data))));
        },
        deflate(data) {
          return new Promise((resolve, reject) => zlib.deflate(data, (err, buf) => (err ? reject(new Error(err.message)) : resolve(buf))));
        },
      },
    },
    currentScriptInfo: { ...scriptInfo, rawScript: script },
    version: '2.0.0',
    env: 'desktop',
  };

  const scriptConsole = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    scriptConsole[level] = (...args) => log(level, args.map(arg => (typeof arg === 'string' ? arg : (() => {
      try { return JSON.stringify(arg); } catch { return String(arg); }
    })())).join(' '));
  }

  const sandbox = {
    lx,
    console: scriptConsole,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    atob, btoa, TextEncoder, TextDecoder, URL, URLSearchParams,
    // Scripts written for LX's renderer window sometimes ask for these.
    navigator: { userAgent: 'Mozilla/5.0 lx-music-desktop/2.0.0' },
  };
  const context = vm.createContext(sandbox, { name: `lx-user-api:${scriptInfo.name}`, codeGeneration: { strings: true, wasm: false } });
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', context);
  try {
    vm.runInContext(String(script), context, { filename: `${scriptInfo.name || 'user-api'}.js`, timeout: 10_000 });
  } catch (error) {
    failInit(String(error?.message || error).replace(/^Uncaught\sError:\s/, ''));
  }

  // One request to the script, checked like LX checks the answer.
  async function handle({ source, action, info }) {
    await ready;
    if (!requestHandler) throw new Error('Request event is not defined');
    const response = await requestHandler.call(lx, { source, action, info });
    switch (action) {
      case 'musicUrl':
        if (!isUrl(response)) throw new Error('Script answered musicUrl with something that is not a URL');
        return { type: info?.type, url: response };
      case 'lyric':
        return verifyLyricInfo(response);
      case 'pic':
        if (!isUrl(response)) throw new Error('Script answered pic with something that is not a URL');
        return response;
      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }

  return { ready, handle, info: scriptInfo, failInit };
}

module.exports = { createLxRuntime, parseScriptInfo, normalizeSources, EVENT_NAMES, SUPPORT_QUALITYS };

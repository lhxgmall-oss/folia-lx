// capacitor/lx/androidCore.js
// Bundle entry of the LX core that runs inside the Android app's WebView (dev/lx/bundleAndroidLx.mjs ->
// src/services/onlineMusic/lx/android/generated/lxAndroidCore.js). It is the desktop bridge itself
// (electron/lx/lxApiBridge.cjs with userApiManager.cjs, lxMyLists.cjs, lxListFile.cjs, lxCoverFill.cjs
// and the vendored musicSdk), unchanged, with what Electron's main process gave it replaced:
//   - Node's fs / path / crypto / zlib / Buffer by the shims in ./shims (files in memory, written
//     through to the app's data directory by the persister the caller hands in);
//   - lxHttp.cjs by ./lxHttpMobile.js over the native HTTP of the LxNative plugin;
//   - the utilityProcess a source script runs in by a Web Worker (./scriptWorker.js), whose lx.request
//     comes back here and goes out through the same native HTTP;
//   - Electron's file dialog by the caller's file picker.
// The answer of request(operation, params) is the same { ok, data } / { ok: false, error } as on desktop,
// so the renderer's lxTransport.ts only chooses this path instead of window.electron.lxRequest.
import './shims/bufferGlobal.js'
import { Buffer } from 'buffer'
import * as sdk from '../../electron/lx/musicSdk/entry.js'
import userApi from '../../electron/lx/userApi/userApiManager.cjs'
import bridgeModule from '../../electron/lx/lxApiBridge.cjs'
import myListsModule from '../../electron/lx/myLists/lxMyLists.cjs'
import { mountVfs } from './shims/fs.js'
import { createMobileRequest } from './lxHttpMobile.js'

const { createUserApiManager } = userApi
const { createLxApiBridge } = bridgeModule
const { createLxMyLists } = myListsModule

const MAX_LIST_FILE_BYTES = 200 * 1024 * 1024
// A script that has not called lx.send('inited') by then is taken as hung and its worker ended.
const INIT_WATCHDOG_MS = 30_000

/**
 * options:
 *   native: { send(req) -> Promise<{ status, statusText, headers, body: Uint8Array }>, abort(id), registerMedia(url) }
 *   files: { [path]: text } every file kept so far (paths start with /lx-user-api or /lx-my-lists)
 *   persist: { write(path, text), remove(path) }
 *   createWorker: () => Worker running ./scriptWorker.js
 *   pickFile: ({ kind: 'script' | 'list' }) -> Promise<Uint8Array | null>
 *   log: console-like
 */
export function createAndroidLxCore({ native, files = {}, persist = null, createWorker, pickFile, log = console }) {
  mountVfs({ entries: files, persist })
  const request = createMobileRequest(native)

  // One source script in its own worker, behind the channel userApiManager.cjs expects of spawnHost.
  const spawnHost = () => {
    const worker = createWorker()
    const messageFns = []
    const exitFns = []
    const inflight = new Map() // id -> abort
    let dead = false
    let inited = false
    const die = code => {
      if (dead) return
      dead = true
      clearTimeout(watchdog)
      for (const abort of inflight.values()) { try { abort() } catch {} }
      inflight.clear()
      try { worker.terminate() } catch {}
      for (const fn of exitFns) fn(code)
    }
    const watchdog = setTimeout(() => { if (!inited) die('the script did not finish loading in time') }, INIT_WATCHDOG_MS)

    // Buffers lose their class on the way out of the worker; lxHttp.cjs tells them apart with Buffer.isBuffer.
    const revive = value => (value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value.buffer, value.byteOffset, value.length) : value)
    const answerHttp = message => {
      const { id, url } = message
      const options = { ...(message.options || {}) }
      options.body = revive(options.body)
      if (options.formData && typeof options.formData === 'object') {
        options.formData = Object.fromEntries(Object.entries(options.formData).map(([name, value]) => [name, revive(value)]))
      }
      const { promise, abort } = request(String(url), options)
      inflight.set(id, abort)
      promise.then(resp => {
        inflight.delete(id)
        if (dead) return
        const raw = new Uint8Array(resp.raw)
        worker.postMessage({
          type: 'http-response', id, ok: true,
          resp: { statusCode: resp.statusCode, statusMessage: resp.statusMessage, headers: resp.headers, bytes: resp.bytes, raw, body: resp.body },
        }, [raw.buffer])
      }, error => {
        inflight.delete(id)
        if (dead) return
        worker.postMessage({ type: 'http-response', id, ok: false, error: { message: String(error?.message || error), code: error?.code } })
      })
    }

    worker.onmessage = event => {
      const message = event.data
      if (!message || typeof message !== 'object' || dead) return
      if (message.type === 'http') { answerHttp(message); return }
      if (message.type === 'http-abort') {
        inflight.get(message.id)?.()
        inflight.delete(message.id)
        return
      }
      if (message.type === 'inited') { inited = true; clearTimeout(watchdog) }
      for (const fn of messageFns) fn(message)
    }
    worker.onerror = event => {
      event?.preventDefault?.()
      const text = String(event?.message || 'worker error')
      log.warn?.(`[LX] script worker: ${text}`)
      if (!inited) die(text)
    }
    return {
      postMessage: message => { if (!dead) worker.postMessage(message) },
      onMessage: fn => { messageFns.push(fn) },
      onExit: fn => { exitFns.push(fn) },
      kill: () => die('killed'),
    }
  }

  const fetchText = async (url, maxBytes) => {
    const response = await request(url, { method: 'get', timeout: 30_000, follow_max: 5 }).promise
    if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`)
    if (response.raw.length > maxBytes) throw new Error('The script is too large')
    return response.raw.toString('utf8')
  }

  const manager = createUserApiManager({ baseDir: () => '/lx-user-api', spawnHost, fetchText, log })
  const myLists = createLxMyLists({ baseDir: () => '/lx-my-lists' })
  const bridge = createLxApiBridge({
    sdk,
    request,
    manager,
    myLists,
    log,
    async pickScriptFile() {
      const bytes = await pickFile({ kind: 'script' })
      return bytes == null ? null : Buffer.from(bytes).toString('utf8')
    },
    async pickListFile() {
      const bytes = await pickFile({ kind: 'list' })
      if (bytes == null) return null
      if (bytes.length > MAX_LIST_FILE_BYTES) throw Object.assign(new Error('The file is too large'), { code: 'invalid-response' })
      return Buffer.from(bytes)
    },
  })

  return {
    async request(operation, params) {
      const result = await bridge.request(operation, params)
      // The audio element reads the URL cross-origin (Web Audio); the native side answers it with CORS
      // headers, as electron/lx/mediaCors.cjs does on desktop.
      if (result.ok && operation === 'music_url' && result.data?.url) {
        try { await native.registerMedia(result.data.url) } catch (error) { log.warn?.('[LX] registerMedia failed', error) }
      }
      return result
    },
    dispose: () => manager.dispose(),
  }
}

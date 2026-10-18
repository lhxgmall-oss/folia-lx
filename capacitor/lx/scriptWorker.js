// capacitor/lx/scriptWorker.js
// The Android counterpart of electron/lx/userApi/scriptHost.cjs: a Web Worker that runs one custom source
// script with electron/lx/userApi/scriptRuntime.cjs (the same lx API 2.0.0 as desktop), bundled by
// dev/lx/bundleAndroidLx.mjs into src/services/onlineMusic/lx/android/generated/lxScriptWorker.js.
// Before the script runs, the worker's own ways out are taken away (fetch, XMLHttpRequest, WebSocket,
// importScripts, ...): its only network is lx.request, which goes to the page (androidCore.js) and out
// through the app's native HTTP. Messages are those of scriptHost.cjs, plus
//   out: { type: 'http', id, url, options } | { type: 'http-abort', id }
//   in:  { type: 'http-response', id, ok, resp?, error? }
import './shims/bufferGlobal.js'
import { Buffer } from 'buffer'
import runtimeModule from '../../electron/lx/userApi/scriptRuntime.cjs'

const { createLxRuntime } = runtimeModule

const post = globalThis.postMessage.bind(globalThis)
const listen = globalThis.addEventListener.bind(globalThis)

for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'Worker', 'SharedWorker', 'BroadcastChannel', 'WebTransport', 'Request', 'Response']) {
  try { Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false }) } catch {}
}

const pending = new Map()
let nextId = 1

function request(url, options) {
  const id = nextId++
  let settle
  const promise = new Promise((resolve, reject) => { settle = { resolve, reject } })
  pending.set(id, settle)
  const { body, form, formData, headers, method, timeout, follow_max } = options || {}
  post({ type: 'http', id, url: String(url), options: { body, form, formData, headers, method, timeout, follow_max } })
  return {
    promise,
    abort() {
      if (!pending.has(id)) return
      pending.delete(id)
      post({ type: 'http-abort', id })
      settle.reject(Object.assign(new Error('Request cancelled'), { code: 'ECANCELLED' }))
    },
  }
}

let runtime = null

async function onMessage(message) {
  if (!message || typeof message !== 'object') return
  if (message.type === 'http-response') {
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.ok) {
      const raw = message.resp.raw instanceof Uint8Array ? message.resp.raw : new Uint8Array(0)
      entry.resolve({ ...message.resp, raw: Buffer.from(raw.buffer, raw.byteOffset, raw.length) })
    } else {
      entry.reject(Object.assign(new Error(message.error?.message || 'Request failed'), { code: message.error?.code }))
    }
    return
  }
  if (message.type === 'load') {
    if (runtime) return
    try {
      runtime = createLxRuntime({
        script: message.script,
        request,
        log: (level, text) => post({ type: 'log', level, message: String(text).slice(0, 2000) }),
        onUpdateAlert: alert => post({ type: 'updateAlert', ...alert }),
      })
      const sources = await runtime.ready
      post({ type: 'inited', ok: true, sources, info: runtime.info })
    } catch (error) {
      post({ type: 'inited', ok: false, message: String(error?.message || error) })
    }
    return
  }
  if (message.type === 'request') {
    const { id, source, action, info } = message
    try {
      if (!runtime) throw new Error('No script loaded')
      const data = await runtime.handle({ source, action, info })
      post({ type: 'response', id, ok: true, data })
    } catch (error) {
      post({ type: 'response', id, ok: false, message: String(error?.message || error).slice(0, 1024) })
    }
  }
}

// An error the script throws later, outside a request: before init it fails the init, after it is logged.
const onStrayError = error => {
  const text = String(error?.message || error)
  if (runtime) runtime.failInit(text)
  post({ type: 'log', level: 'error', message: `uncaught: ${text.slice(0, 1000)}` })
}
listen('error', event => { event.preventDefault(); onStrayError(event.error || event.message) })
listen('unhandledrejection', event => { event.preventDefault(); onStrayError(event.reason) })
listen('message', event => { void onMessage(event.data) })

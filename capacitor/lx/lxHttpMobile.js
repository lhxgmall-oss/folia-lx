// capacitor/lx/lxHttpMobile.js
// The Android counterpart of electron/lx/lxHttp.cjs: the same needle-like request for the musicSdk and
// for a source script's lx.request, over the app's native HTTP (the LxNative Capacitor plugin, OkHttp),
// so there is no CORS and any header can be set. The request body is built by lxHttp.cjs's own
// buildRequestBody; redirects are followed here (only up to follow_max, like needle), and gzip / deflate
// answers are decoded here where the native side did not already.
import { Buffer } from 'buffer'
import { gunzipSync, inflateSync, inflateRawSync } from './shims/zlib.js'
import lxHttp from '../../electron/lx/lxHttp.cjs'

const { buildRequestBody } = lxHttp

const MAX_BODY_BYTES = 20 * 1024 * 1024
let nextId = 1

const decode = (raw, encoding) => {
  try {
    switch (String(encoding || '').toLowerCase()) {
      case 'gzip': return gunzipSync(raw)
      case 'deflate': try { return inflateSync(raw) } catch { return inflateRawSync(raw) }
      default: return raw
    }
  } catch {
    return raw
  }
}

// Headers the native side sets itself, and encodings this side cannot read.
function prepareHeaders(headers) {
  const out = {}
  for (const [name, value] of Object.entries(headers || {})) {
    if (value == null) continue
    const lower = name.toLowerCase()
    if (lower === 'content-length' || lower === 'host' || lower === 'connection') continue
    if (lower === 'accept-encoding') {
      const kept = String(value).split(',').map(part => part.trim()).filter(part => part && !/^br\b/i.test(part) && !/^zstd\b/i.test(part))
      if (kept.length) out[name] = kept.join(', ')
      continue
    }
    out[name] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return out
}

/**
 * `native`: { send({ id, url, method, headers, body, timeout }) -> Promise<{ status, statusText, headers, body: Uint8Array, url }>,
 *             abort(id) }.
 * Answers lxRequest(url, options) -> { promise, abort } with lxHttp.cjs's response shape.
 */
export function createMobileRequest(native) {
  return function lxRequest(url, options = {}) {
    let currentId = null
    let aborted = false
    let cancel = () => {}
    const timeout = typeof options.timeout === 'number' && options.timeout > 0 ? Math.min(options.timeout, 60_000) : 15_000
    const followMax = Number.isInteger(options.follow_max) ? options.follow_max : 0

    const promise = new Promise((resolve, reject) => {
      cancel = () => reject(Object.assign(new Error('Request cancelled'), { code: 'ECANCELLED' }))
      const send = (target, redirectsLeft) => {
        let parsed
        try { parsed = new URL(target) } catch (error) { reject(error); return }
        if (!['http:', 'https:'].includes(parsed.protocol)) { reject(new Error(`Unsupported protocol: ${parsed.protocol}`)); return }
        const { method, headers, body } = buildRequestBody(options)
        const id = nextId++
        currentId = id
        native.send({ id, url: parsed.href, method, headers: prepareHeaders(headers), body: body ? new Uint8Array(body) : null, timeout })
          .then(response => {
            if (aborted) return
            const status = Number(response.status) || 0
            const location = response.headers?.location
            if (status >= 300 && status < 400 && location && redirectsLeft > 0) {
              send(new URL(Array.isArray(location) ? location[0] : location, parsed).href, redirectsLeft - 1)
              return
            }
            const bytes = response.body instanceof Uint8Array ? response.body : new Uint8Array(0)
            if (bytes.length > MAX_BODY_BYTES) { reject(new Error('Response too large')); return }
            const raw = decode(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length), response.headers?.['content-encoding'])
            const text = raw.toString()
            let parsedBody = text
            try { parsedBody = JSON.parse(text) } catch {}
            resolve({
              statusCode: status,
              statusMessage: response.statusText || '',
              headers: response.headers || {},
              bytes: raw.length,
              raw,
              body: parsedBody,
            })
          }, error => {
            if (!aborted) reject(Object.assign(new Error(error?.message || String(error)), { code: error?.code }))
          })
      }
      send(url, followMax)
    })

    return {
      promise,
      abort() {
        if (aborted) return
        aborted = true
        if (currentId != null) native.abort(currentId)
        cancel()
      },
    }
  }
}

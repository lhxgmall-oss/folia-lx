// capacitor/lx/shims/zlib.js
// The part of node:zlib the LX code calls, over pako: inflate / deflate (callback), the *Sync forms,
// gunzip, and inflate with finishFlush Z_SYNC_FLUSH (tx/qrcDecode.js reads streams with a cut-off tail).
// Brotli is not available: requests from the Android port never ask for it (see ../lxHttpMobile.js).
import pako from 'pako'
import { Buffer } from 'buffer'

export const constants = Object.freeze({
  Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5,
  Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_BUF_ERROR: -5,
})

const bytesOf = data => (typeof data === 'string' ? Buffer.from(data) : (data instanceof Uint8Array ? data : Buffer.from(data)))
const concat = chunks => Buffer.concat(chunks.map(chunk => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length)))

// One inflate. `kind`: 'zlib' | 'raw' | 'gzip' | 'auto'. Where finishFlush is Z_SYNC_FLUSH a stream that
// ends early answers what it decoded so far instead of failing, as Node does.
function inflateWith(kind, data, options = {}) {
  const tolerant = options.finishFlush === constants.Z_SYNC_FLUSH
  const settings = kind === 'raw' ? { raw: true } : (kind === 'gzip' ? { windowBits: 31 } : (kind === 'auto' ? { windowBits: 47 } : {}))
  const inflator = new pako.Inflate(settings)
  inflator.push(bytesOf(data), tolerant ? constants.Z_SYNC_FLUSH : true)
  if (inflator.err) throw Object.assign(new Error(inflator.msg || 'invalid data'), { code: 'Z_DATA_ERROR', errno: inflator.err })
  if (inflator.result && inflator.ended) return Buffer.from(inflator.result.buffer, inflator.result.byteOffset, inflator.result.length)
  if (tolerant) return concat(inflator.chunks || [])
  if (!inflator.ended) throw Object.assign(new Error('unexpected end of file'), { code: 'Z_BUF_ERROR', errno: -5 })
  return concat(inflator.chunks || [])
}

const deflateWith = (kind, data, options = {}) => {
  const out = kind === 'raw' ? pako.deflateRaw(bytesOf(data), options) : (kind === 'gzip' ? pako.gzip(bytesOf(data), options) : pako.deflate(bytesOf(data), options))
  return Buffer.from(out.buffer, out.byteOffset, out.length)
}

const async = run => (data, options, callback) => {
  const done = typeof options === 'function' ? options : callback
  const opts = typeof options === 'object' && options ? options : {}
  setTimeout(() => {
    let result
    try { result = run(data, opts) } catch (error) { done?.(error); return }
    done?.(null, result)
  }, 0)
}

export const inflateSync = (data, options) => inflateWith('zlib', data, options)
export const inflateRawSync = (data, options) => inflateWith('raw', data, options)
export const gunzipSync = (data, options) => inflateWith('gzip', data, options)
export const unzipSync = (data, options) => inflateWith('auto', data, options)
export const deflateSync = (data, options) => deflateWith('zlib', data, options)
export const deflateRawSync = (data, options) => deflateWith('raw', data, options)
export const gzipSync = (data, options) => deflateWith('gzip', data, options)
export const brotliDecompressSync = () => { throw new Error('brotli is not available') }

export const inflate = async(inflateSync)
export const inflateRaw = async(inflateRawSync)
export const gunzip = async(gunzipSync)
export const unzip = async(unzipSync)
export const deflate = async(deflateSync)
export const deflateRaw = async(deflateRawSync)
export const gzip = async(gzipSync)

export default {
  constants, inflate, inflateRaw, gunzip, unzip, deflate, deflateRaw, gzip,
  inflateSync, inflateRawSync, gunzipSync, unzipSync, deflateSync, deflateRawSync, gzipSync, brotliDecompressSync,
}

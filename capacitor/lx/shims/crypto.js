// capacitor/lx/shims/crypto.js
// The part of node:crypto the LX code calls, for the Android WebView and the source script worker:
// createHash (md5 / sha1 / sha256), createCipheriv / createDecipheriv (AES, ECB or CBC, PKCS#7 padding as
// Node pads by default), publicEncrypt with RSA_NO_PADDING (what NetEase's weapi and lx.utils.crypto
// .rsaEncrypt use), randomBytes. Hashes and AES come from node-forge; RSA is a BigInt modPow.
import forge from 'node-forge/lib/forge.js'
import 'node-forge/lib/md5.js'
import 'node-forge/lib/sha1.js'
import 'node-forge/lib/sha256.js'
import 'node-forge/lib/aes.js'
import { Buffer } from 'buffer'

const toBinary = (data, encoding) => (typeof data === 'string' ? Buffer.from(data, encoding || 'utf8') : Buffer.from(data)).toString('binary')
const fromBinary = binary => Buffer.from(binary, 'binary')

export const constants = Object.freeze({ RSA_NO_PADDING: 3, RSA_PKCS1_PADDING: 1, RSA_PKCS1_OAEP_PADDING: 4 })

export function createHash(algorithm) {
  const name = String(algorithm).toLowerCase().replace('-', '')
  const factory = forge.md[name]
  if (!factory) throw new Error(`Digest method not supported: ${algorithm}`)
  const md = factory.create()
  const hash = {
    update(data, encoding) {
      md.update(toBinary(data, encoding))
      return hash
    },
    digest(encoding) {
      const out = fromBinary(md.digest().getBytes())
      return encoding ? out.toString(encoding) : out
    },
  }
  return hash
}

const cipherName = mode => {
  const match = /^aes-(128|192|256)-(ecb|cbc|cfb|ofb|ctr)$/.exec(String(mode).toLowerCase())
  if (!match) throw new Error(`Unknown cipher: ${mode}`)
  return { name: `AES-${match[2].toUpperCase()}`, block: ['ECB', 'CBC'].includes(match[2].toUpperCase()) }
}

function createAes(decrypt, mode, key, iv) {
  const { name, block } = cipherName(mode)
  const keyBinary = toBinary(key)
  const cipher = decrypt ? forge.cipher.createDecipher(name, keyBinary) : forge.cipher.createCipher(name, keyBinary)
  const ivBinary = iv == null || iv === '' ? '' : toBinary(iv)
  cipher.start(name === 'AES-ECB' ? {} : { iv: ivBinary })
  let autoPadding = true
  let used = false
  const take = () => {
    const bytes = cipher.output.getBytes()
    return fromBinary(bytes)
  }
  return {
    setAutoPadding(value = true) {
      autoPadding = value
      return this
    },
    update(data, inputEncoding, outputEncoding) {
      // Everything comes out of final(): forge strips the padding only from output it still holds.
      cipher.update(forge.util.createBuffer(toBinary(data, inputEncoding)))
      const out = Buffer.alloc(0)
      return outputEncoding ? out.toString(outputEncoding) : out
    },
    final(outputEncoding) {
      if (used) throw new Error('Cipher already finalised')
      used = true
      let ok
      if (block && !autoPadding) ok = cipher.finish(() => true)
      else ok = cipher.finish()
      if (ok === false) throw new Error('bad decrypt')
      const out = take()
      return outputEncoding ? out.toString(outputEncoding) : out
    },
  }
}

export const createCipheriv = (mode, key, iv) => createAes(false, mode, key, iv)
export const createDecipheriv = (mode, key, iv) => createAes(true, mode, key, iv)

// --- RSA without padding ---------------------------------------------------------------------------

// A DER walk to the modulus and exponent of an RSA public key, PKCS#1 (RSA PUBLIC KEY) or SPKI
// (PUBLIC KEY): the first SEQUENCE holding two INTEGERs is RSAPublicKey { n, e }.
function readDer(bytes, offset) {
  const tag = bytes[offset]
  let length = bytes[offset + 1]
  let header = 2
  if (length & 0x80) {
    const count = length & 0x7f
    length = 0
    for (let index = 0; index < count; index += 1) length = (length * 256) + bytes[offset + 2 + index]
    header += count
  }
  return { tag, start: offset + header, end: offset + header + length }
}

const toBigInt = bytes => {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex ? BigInt(`0x${hex}`) : 0n
}

function findRsaKey(bytes, start, end) {
  let offset = start
  while (offset < end) {
    const node = readDer(bytes, offset)
    if (node.tag === 0x30) {
      const first = readDer(bytes, node.start)
      if (first.tag === 0x02 && first.end < node.end) {
        const second = readDer(bytes, first.end)
        if (second.tag === 0x02) return { n: toBigInt(bytes.subarray(first.start, first.end)), e: toBigInt(bytes.subarray(second.start, second.end)) }
      }
      const inner = findRsaKey(bytes, node.start, node.end)
      if (inner) return inner
    } else if (node.tag === 0x03) {
      // BIT STRING: one byte of unused-bit count, then the RSAPublicKey
      const inner = findRsaKey(bytes, node.start + 1, node.end)
      if (inner) return inner
    }
    offset = node.end
  }
  return null
}

const keyCache = new Map()
function parsePublicKey(pem) {
  const text = typeof pem === 'string' ? pem : (pem?.key ?? String(pem))
  if (keyCache.has(text)) return keyCache.get(text)
  const base64 = String(text).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const bytes = Buffer.from(base64, 'base64')
  const key = findRsaKey(bytes, 0, bytes.length)
  if (!key) throw new Error('Unsupported RSA public key')
  key.size = Math.ceil(key.n.toString(16).length / 2)
  keyCache.set(text, key)
  return key
}

const modPow = (base, exponent, modulus) => {
  let result = 1n
  let b = base % modulus
  let e = exponent
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus
    b = (b * b) % modulus
    e >>= 1n
  }
  return result
}

export function publicEncrypt(options, buffer) {
  const keyText = typeof options === 'string' || Buffer.isBuffer(options) ? String(options) : options.key
  const padding = typeof options === 'object' && options && !Buffer.isBuffer(options) ? options.padding : undefined
  if (padding !== constants.RSA_NO_PADDING) throw new Error('Only RSA_NO_PADDING is supported here')
  const key = parsePublicKey(keyText)
  const input = Buffer.from(buffer)
  if (input.length > key.size) throw new Error('data too large for key size')
  const out = modPow(toBigInt(input), key.e, key.n).toString(16).padStart(key.size * 2, '0')
  return Buffer.from(out, 'hex')
}

export function randomBytes(size, callback) {
  const out = Buffer.alloc(size)
  globalThis.crypto.getRandomValues(out)
  if (typeof callback === 'function') {
    setTimeout(() => callback(null, out), 0)
    return undefined
  }
  return out
}

export const randomUUID = () => globalThis.crypto.randomUUID()

export default { createHash, createCipheriv, createDecipheriv, publicEncrypt, randomBytes, randomUUID, constants }

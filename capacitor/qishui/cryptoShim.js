// capacitor/qishui/cryptoShim.js
// The part of node:crypto qishui-music-api calls, for the Android WebView: createHash('md5'),
// randomBytes, randomUUID, and P-256 ECDSA (generateKeyPairSync('ec', prime256v1), key export as SPKI DER /
// PKCS#8 PEM, createPrivateKey from that PEM, sign('sha256') with a DER signature, as Node returns it).
// The curve math is @noble/curves; md5 comes from node-forge like the LX shim.
import { p256 } from '@noble/curves/nist.js'
import forge from 'node-forge/lib/forge.js'
import 'node-forge/lib/md5.js'
import { Buffer } from 'buffer'

const SPKI_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex')
const PKCS8_PREFIX = Buffer.from('308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420', 'hex')
const PKCS8_PUB = Buffer.from('a144034200', 'hex')
const EC_PRIV_MARK = Buffer.from('0201010420', 'hex')

export function randomBytes(size) {
  const out = Buffer.alloc(size)
  globalThis.crypto.getRandomValues(out)
  return out
}

export const randomUUID = () => globalThis.crypto.randomUUID()

export function createHash(algorithm) {
  if (String(algorithm).toLowerCase() !== 'md5') throw new Error(`Digest method not supported: ${algorithm}`)
  const md = forge.md.md5.create()
  const hash = {
    update(data, encoding) {
      md.update((typeof data === 'string' ? Buffer.from(data, encoding || 'utf8') : Buffer.from(data)).toString('binary'))
      return hash
    },
    digest(encoding) {
      const out = Buffer.from(md.digest().getBytes(), 'binary')
      return encoding ? out.toString(encoding) : out
    },
  }
  return hash
}

const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`

function makeKey(secret) {
  const pub = Buffer.from(p256.getPublicKey(secret, false))
  return {
    type: 'private',
    asymmetricKeyType: 'ec',
    asymmetricKeyDetails: { namedCurve: 'prime256v1' },
    __secret: Buffer.from(secret),
    export({ type, format } = {}) {
      if (type !== 'pkcs8') throw new Error(`Unsupported key export: ${type}`)
      const der = Buffer.concat([PKCS8_PREFIX, Buffer.from(secret), PKCS8_PUB, pub])
      return format === 'pem' ? pem('PRIVATE KEY', der) : der
    },
    __public: {
      type: 'public',
      asymmetricKeyType: 'ec',
      export({ type, format } = {}) {
        if (type !== 'spki') throw new Error(`Unsupported key export: ${type}`)
        const der = Buffer.concat([SPKI_PREFIX, pub])
        return format === 'pem' ? pem('PUBLIC KEY', der) : der
      },
    },
  }
}

export function generateKeyPairSync(type, options = {}) {
  if (type !== 'ec' || !['prime256v1', 'P-256'].includes(options.namedCurve)) throw new Error('Only P-256 keys are supported')
  const key = makeKey(p256.utils.randomSecretKey())
  return { privateKey: key, publicKey: key.__public }
}

export function createPrivateKey(input) {
  const text = typeof input === 'string' ? input : String(input?.key ?? input)
  const body = text.replace(/-----(BEGIN|END) [^-]+-----/g, '').replace(/\s+/g, '')
  const der = Buffer.from(body, 'base64')
  if (!der.includes(Buffer.from('2a8648ce3d030107', 'hex'))) throw new Error('Only P-256 keys are supported')
  const at = der.indexOf(EC_PRIV_MARK)
  if (at < 0 || at + EC_PRIV_MARK.length + 32 > der.length) throw new Error('Unreadable private key')
  return makeKey(der.subarray(at + EC_PRIV_MARK.length, at + EC_PRIV_MARK.length + 32))
}

export function sign(algorithm, data, key) {
  if (String(algorithm).toLowerCase().replace('-', '') !== 'sha256') throw new Error(`Unsupported sign algorithm: ${algorithm}`)
  const secret = key?.__secret ?? createPrivateKey(key).__secret
  // Node signs with random k and does not force low-S; either is a valid ECDSA signature for the server.
  return Buffer.from(p256.sign(Buffer.from(data), secret, { prehash: true, format: 'der' }))
}

export default { randomBytes, randomUUID, createHash, generateKeyPairSync, createPrivateKey, sign }

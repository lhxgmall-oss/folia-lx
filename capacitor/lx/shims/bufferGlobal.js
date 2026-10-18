// capacitor/lx/shims/bufferGlobal.js
// Node's global Buffer for the LX code that runs in the Android WebView (and its script worker): the
// vendored musicSdk and the shared bridge code use Buffer at module load, so this is imported first.
import { Buffer } from 'buffer'

if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer

export { Buffer }

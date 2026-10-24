// capacitor/qishui/androidQishui.js
// The Qishui bridge of the Android app: what electron/qishui/qishuiApiBridge.cjs + session.cjs do in the
// desktop main process, run in the WebView. qishui-music-api itself is bundled unchanged (node:crypto →
// cryptoShim.js); the host hands it a fetch that goes out natively (OkHttp, no CORS, no cookies) and a
// small synchronous store. Bundled by `npm run build:lx-android` into
// src/services/onlineMusic/qishui/android/generated/qishuiAndroidCore.js.
import '../lx/shims/bufferGlobal.js'
import { createQishuiApi, QISHUI_OPERATIONS, createQishuiDeviceId, isQishuiDeviceId } from 'qishui-music-api'

const SESSION_KEY = 'QISHUI_SESSION_V1'
const DEVICE_KEY = 'QISHUI_DEVICE_ID'

function createSessions(store, warn) {
  let deviceId = store.get(DEVICE_KEY)
  if (!isQishuiDeviceId(deviceId)) {
    deviceId = createQishuiDeviceId()
    store.set(DEVICE_KEY, deviceId)
  }
  let loaded = false
  let current = null
  let revision = 0
  return {
    deviceId,
    get revision() { return revision },
    get() {
      if (!loaded) {
        loaded = true
        try {
          const raw = store.get(SESSION_KEY)
          const value = raw ? JSON.parse(raw) : null
          if (value && value.version === 1 && value.userId && value.ticket && value.guardKey) current = value
        } catch {
          warn('[Qishui] Account could not be restored: the saved account is not readable')
        }
      }
      return current
    },
    set(value) {
      loaded = true
      current = { ...value, version: 1 }
      revision++
      store.set(SESSION_KEY, JSON.stringify(current))
    },
    clear() {
      loaded = true
      current = null
      revision++
      store.remove(SESSION_KEY)
    },
  }
}

export function createAndroidQishuiCore({ fetch, store, onAudioSource = () => {}, log = console.info, warn = console.warn }) {
  const sessions = createSessions(store, warn)
  const api = createQishuiApi({ deviceId: sessions.deviceId, sessions, fetch, log, warn })
  return {
    async request(operation, params = {}) {
      try {
        if (!QISHUI_OPERATIONS.includes(operation)) {
          return { ok: false, error: { code: 'unsupported', message: 'Unsupported Qishui operation' } }
        }
        const result = await api.request(operation, params)
        if (result.ok && operation === 'audio' && result.data?.url) await onAudioSource(result.data.url)
        return result
      } catch (error) {
        warn('[Qishui] android bridge request failed', { operation }, error)
        return { ok: false, error: { code: 'invalid-response', message: 'Qishui operation failed' } }
      }
    },
  }
}

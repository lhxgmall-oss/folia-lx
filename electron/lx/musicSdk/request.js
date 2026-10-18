// electron/lx/musicSdk/request.js
// Stand-in for lx-music-desktop's src/renderer/utils/request.js, so the vendored musicSdk modules
// under ./src run in Electron's main process. Only bundled (dev/lx/bundleMusicSdk.mjs), never loaded
// directly. The HTTP layer itself lives in ../lxHttp.cjs; it is handed in through setRequester so the
// same bundle runs under Electron and under Vitest with a fake.

let requester = null

/** Sets the function every musicSdk request goes through: (url, options) => { promise, abort }. */
export const setRequester = fn => {
  requester = fn
}

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
}

/**
 * The shape the musicSdk expects: { promise, cancelHttp }. The promise resolves to
 * { statusCode, statusMessage, headers, raw, body } with body parsed as JSON where it parses.
 */
export const httpFetch = (url, options = { method: 'get' }) => {
  if (!requester) {
    return { promise: Promise.reject(new Error('LX musicSdk has no requester')), cancelHttp() {} }
  }
  const { promise, abort } = requester(url, {
    ...options,
    headers: Object.assign({}, defaultHeaders, options.headers || {}),
    timeout: typeof options.timeout === 'number' ? options.timeout : 15000,
  })
  const requestObj = {
    promise,
    cancelHttp() {
      try { abort?.() } catch {}
    },
  }
  return requestObj
}

export const cancelHttp = requestObj => {
  requestObj?.cancelHttp?.()
}

// capacitor/lx/shims/vm.js
// node:vm for scriptRuntime.cjs inside the source script worker (../scriptWorker.js). A worker runs one
// script and nothing else, so the worker's own global object is the script's context: createContext puts
// the sandbox's names on it (the worker already took away fetch, XMLHttpRequest and the like before the
// script runs), and runInContext evaluates in global scope. The isolation is the worker itself: no DOM,
// no Capacitor bridge, no storage of the app, network only through lx.request.
export function createContext(sandbox) {
  for (const [name, value] of Object.entries(sandbox || {})) {
    try {
      Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false })
    } catch {
      try { globalThis[name] = value } catch {}
    }
  }
  return globalThis
}

// eslint-disable-next-line no-eval
const globalEval = eval
export function runInContext(code) {
  return globalEval(String(code))
}

export default { createContext, runInContext }

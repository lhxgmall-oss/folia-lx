const { createLxRuntime } = require('./scriptRuntime.cjs');
const { lxRequest } = require('../lxHttp.cjs');

// electron/lx/userApi/scriptHost.cjs
// The process a custom source script runs in: an Electron utilityProcess (process.parentPort) or,
// outside Electron, a child_process.fork (process.send). One script per process; the main process
// (./userApiManager.cjs) kills it to unload the script. Messages:
//   in:  { type: 'load', script }  |  { type: 'request', id, source, action, info }
//   out: { type: 'inited', ok, sources?, message?, info? }  |  { type: 'response', id, ok, data?, message? }
//        { type: 'log', level, message }  |  { type: 'updateAlert', log, updateUrl }

const port = process.parentPort || null;
const post = message => {
  if (port) port.postMessage(message);
  else if (process.send) process.send(message);
};

let runtime = null;

const onMessage = async message => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'load') {
    if (runtime) return;
    try {
      runtime = createLxRuntime({
        script: message.script,
        request: lxRequest,
        log: (level, text) => post({ type: 'log', level, message: String(text).slice(0, 2000) }),
        onUpdateAlert: alert => post({ type: 'updateAlert', ...alert }),
      });
      const sources = await runtime.ready;
      post({ type: 'inited', ok: true, sources, info: runtime.info });
    } catch (error) {
      post({ type: 'inited', ok: false, message: String(error?.message || error) });
    }
    return;
  }
  if (message.type === 'request') {
    const { id, source, action, info } = message;
    try {
      if (!runtime) throw new Error('No script loaded');
      const data = await runtime.handle({ source, action, info });
      post({ type: 'response', id, ok: true, data });
    } catch (error) {
      post({ type: 'response', id, ok: false, message: String(error?.message || error).slice(0, 1024) });
    }
  }
};

// An error the script throws later, outside a request (a timer, a promise nobody awaited): before
// init it fails the init, as in LX; after init it is only logged.
const onStrayError = error => {
  const text = String(error?.message || error);
  if (runtime) runtime.failInit(text);
  post({ type: 'log', level: 'error', message: `uncaught: ${text.slice(0, 1000)}` });
};
process.on('uncaughtException', onStrayError);
process.on('unhandledRejection', onStrayError);

if (port) port.on('message', event => onMessage(event.data));
else process.on('message', onMessage);

const path = require('node:path');
const fs = require('node:fs');
const childProcess = require('node:child_process');
const sdk = require('./musicSdk/lxMusicSdk.cjs');
const { lxRequest } = require('./lxHttp.cjs');
const { createUserApiManager } = require('./userApi/userApiManager.cjs');
const { createLxApiBridge } = require('./lxApiBridge.cjs');
const { createLxMediaPolicy } = require('./mediaCors.cjs');
const { createLxMyLists } = require('./myLists/lxMyLists.cjs');

// An exported LX list file larger than this is not read (a full backup of a big library is a few MB).
const MAX_LIST_FILE_BYTES = 200 * 1024 * 1024;

// electron/lx/lxDesktop.cjs
// Wires the LX provider into Electron: where scripts are kept (userData/lx-user-api), the process a
// script runs in (utilityProcess, or child_process.fork where there is none), the file picker for
// importing a script, and the CORS policy for the audio URLs a script hands out. main.cjs only calls
// createLxDesktop and routes the `lx-api-request` channel to `bridge.request`.

const HOST_PATH = path.join(__dirname, 'userApi', 'scriptHost.cjs');

// A channel to ./userApi/scriptHost.cjs in its own process.
function spawnScriptHost(utilityProcess) {
  if (utilityProcess?.fork) {
    const child = utilityProcess.fork(HOST_PATH, [], { serviceName: 'Folia LX source script', stdio: 'ignore' });
    return {
      postMessage: message => child.postMessage(message),
      onMessage: fn => child.on('message', fn),
      onExit: fn => child.on('exit', fn),
      kill: () => child.kill(),
    };
  }
  const child = childProcess.fork(HOST_PATH, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  return {
    postMessage: message => child.send(message),
    onMessage: fn => child.on('message', fn),
    onExit: fn => child.on('exit', fn),
    kill: () => child.kill(),
  };
}

async function fetchScriptText(url, maxBytes) {
  const response = await lxRequest(url, { method: 'get', timeout: 30_000, follow_max: 5 }).promise;
  if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`);
  if (response.raw.length > maxBytes) throw new Error('The script is too large');
  return response.raw.toString('utf8');
}

function createLxDesktop({ app, dialog, utilityProcess, getParentWindow = () => null, log = console }) {
  const media = createLxMediaPolicy();
  const manager = createUserApiManager({
    baseDir: () => path.join(app.getPath('userData'), 'lx-user-api'),
    spawnHost: () => spawnScriptHost(utilityProcess),
    fetchText: fetchScriptText,
    log,
  });
  const myLists = createLxMyLists({ baseDir: () => path.join(app.getPath('userData'), 'lx-my-lists') });
  const bridge = createLxApiBridge({
    sdk,
    request: lxRequest,
    manager,
    myLists,
    log,
    async pickListFile() {
      const result = await dialog.showOpenDialog(getParentWindow() || undefined, {
        properties: ['openFile'],
        filters: [
          { name: 'LX Music list (.lxmc / .json)', extensions: ['lxmc', 'json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePaths?.[0]) return null;
      const stat = await fs.promises.stat(result.filePaths[0]);
      if (stat.size > MAX_LIST_FILE_BYTES) throw Object.assign(new Error('The file is too large'), { code: 'invalid-response' });
      return fs.promises.readFile(result.filePaths[0]);
    },
    async pickScriptFile() {
      const result = await dialog.showOpenDialog(getParentWindow() || undefined, {
        properties: ['openFile'],
        filters: [{ name: 'LX source script', extensions: ['js'] }],
      });
      if (result.canceled || !result.filePaths?.[0]) return null;
      return fs.promises.readFile(result.filePaths[0], 'utf8');
    },
  });
  return {
    media,
    async request(operation, params) {
      const result = await bridge.request(operation, params);
      if (result.ok && operation === 'music_url' && result.data?.url) media.register(result.data.url);
      return result;
    },
    dispose: () => manager.dispose(),
  };
}

module.exports = { createLxDesktop, spawnScriptHost };

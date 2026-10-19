// electron/wallpaper/macDesktopClickGuard.cjs
// Runs folia-desktop-click-guard (packaging/macos/desktop-click-guard/main.swift) for the macOS
// wallpaper while Stage Manager is on and the desktop icons are shown (issue #698): the helper
// keeps a click on the bare wallpaper away from Finder, so Stage Manager does not send the stage
// aside, and leaves clicks on icons alone. Folia's own listen-only tap still forwards the click into
// the wallpaper. The helper needs the Accessibility grant (attributed to Folia, which spawns it);
// without it Folia falls back to the click catchers over the controls (macWallpaperHitPanels.cjs).
//
// Lifecycle: start(region) spawns it, setRegion() keeps it on the wallpaper's frame, stop() closes
// its stdin (it exits on EOF; the system drops its tap with the process). An unexpected exit is
// retried a few times with a delay, then left off for the session. No Electron imports: the spawn
// and the trust check are injectable for headless tests.

const fs = require('fs');

const RESTART_DELAY_MS = 2000;
const MAX_RESTARTS = 3;

function formatRegion(rect) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return 'region none';
  return `region ${rect.x} ${rect.y} ${rect.width} ${rect.height}`;
}

let trustFn = null;
// AXIsProcessTrusted() through koffi: whether Folia holds the Accessibility grant. false when the
// bridge is missing.
function isAccessibilityTrusted() {
  if (process.platform !== 'darwin') return false;
  try {
    if (!trustFn) {
      const koffi = require('koffi');
      const lib = koffi.load('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices');
      trustFn = lib.func('bool AXIsProcessTrusted(void)');
    }
    return trustFn() === true;
  } catch (e) {
    return false;
  }
}

function createMacDesktopClickGuard({
  helperPath,
  spawn = require('child_process').spawn,
  existsSync = fs.existsSync,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logWarn = console.warn.bind(console),
}) {
  let child = null;
  let wanted = false;
  let region = null;
  let restarts = 0;
  let restartTimer = null;
  let gaveUp = false; // kept exiting: off for the session
  let lastExit = null; // 'untrusted' | 'tap-failed' | 'crashed' | null

  function send(line) {
    if (!child || !child.stdin || child.stdin.destroyed) return;
    try {
      child.stdin.write(`${line}\n`);
    } catch (e) {
      // the exit handler takes care of a dead helper
    }
  }

  function spawnHelper() {
    const file = typeof helperPath === 'function' ? helperPath() : helperPath;
    if (!file || !existsSync(file)) {
      lastExit = 'missing';
      return false;
    }
    let proc;
    try {
      proc = spawn(file, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) {
      logWarn('[WallpaperMac] click guard spawn failed:', e && e.message);
      lastExit = 'crashed';
      return false;
    }
    child = proc;
    let said = null;
    proc.stdout?.setEncoding?.('utf8');
    proc.stdout?.on?.('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        const word = line.trim();
        if (word === 'untrusted' || word === 'tap-failed') said = word;
        if (word === 'ready') restarts = 0;
      }
    });
    proc.stdin?.on?.('error', () => {});
    proc.on('error', () => {});
    proc.on('exit', () => {
      if (child === proc) child = null;
      lastExit = said || 'crashed';
      if (!wanted || said) return; // asked to stop, or it cannot run: no retry
      if (restarts >= MAX_RESTARTS) {
        gaveUp = true;
        logWarn('[WallpaperMac] click guard keeps exiting; off for this session');
        return;
      }
      restarts += 1;
      restartTimer = setTimer(() => {
        restartTimer = null;
        if (wanted && !child) start(region);
      }, RESTART_DELAY_MS);
      if (typeof restartTimer?.unref === 'function') restartTimer.unref();
    });
    send(formatRegion(region));
    return true;
  }

  function start(nextRegion) {
    wanted = true;
    region = nextRegion || null;
    if (child) {
      send(formatRegion(region));
      return true;
    }
    if (gaveUp) return false;
    return spawnHelper();
  }

  function setRegion(nextRegion) {
    region = nextRegion || null;
    send(formatRegion(region));
  }

  function stop() {
    wanted = false;
    if (restartTimer) {
      clearTimer(restartTimer);
      restartTimer = null;
    }
    const proc = child;
    child = null;
    if (!proc) return;
    try {
      proc.stdin?.end?.(); // EOF: the helper exits on its own
    } catch (e) {
      // ignore
    }
    try {
      proc.kill?.();
    } catch (e) {
      // ignore
    }
  }

  // Shows macOS' Accessibility prompt for Folia (the helper's responsible app), then exits.
  function requestAccess() {
    const file = typeof helperPath === 'function' ? helperPath() : helperPath;
    if (!file || !existsSync(file)) return false;
    try {
      const proc = spawn(file, ['--prompt'], { stdio: 'ignore' });
      proc.on?.('error', () => {});
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    start,
    setRegion,
    requestAccess,
    stop,
    isRunning: () => !!child,
    lastExit: () => lastExit,
  };
}

module.exports = {
  MAX_RESTARTS,
  formatRegion,
  isAccessibilityTrusted,
  createMacDesktopClickGuard,
};

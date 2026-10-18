// electron/lx/myLists/lxCoverFill.cjs
// Fills the covers LX left out of exported lists (meta.picUrl is often empty, kw/kg rows never have
// one). In the background, a few at a time, each song without a cover is asked of its sub-source's
// musicSdk getPic; what comes back is written into the kept list (lxMyLists.applyCovers) so it stays.
// A song whose cover cannot be had stays without one and is not asked again in this run of the app.
// The import does not wait for this; the settings page reads the progress (`status`).

const SAVE_EVERY = 25;

function createLxCoverFill({ myLists, getPic, concurrency = 4, timeoutMs = 15_000, log = console }) {
  let running = null; // Promise of the run under way
  let again = false; // asked to start while running: run once more after
  const tried = new Set(); // `<source>_<songmid>` asked this run of the app
  let status = { running: false, done: 0, total: 0, filled: 0 };

  const withTimeout = promise => new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
  });

  // Every song still without a cover, one entry per song (a song in two lists is asked once).
  const missing = () => {
    const bySong = new Map();
    for (const list of myLists.list()) {
      for (const row of myLists.songsOf(list.key)) {
        if (!row || row.img) continue;
        const id = `${row.source}_${row.songmid}`;
        if (tried.has(id)) continue;
        const one = bySong.get(id) || { id, row, keys: new Set() };
        one.keys.add(list.key);
        bySong.set(id, one);
      }
    }
    return [...bySong.values()];
  };

  const runOnce = async () => {
    const todo = missing();
    status = { running: true, done: 0, total: todo.length, filled: 0 };
    if (!todo.length) return;
    const found = new Map(); // list key -> Map(song id -> url), not yet written
    const flush = () => {
      for (const [key, covers] of found) {
        try { myLists.applyCovers(key, covers); } catch (error) { log.warn?.('[LX] covers: saving failed', error); }
      }
      found.clear();
    };
    let next = 0;
    let sinceSave = 0;
    const worker = async () => {
      while (next < todo.length) {
        const one = todo[next++];
        tried.add(one.id);
        let url = null;
        try {
          url = await withTimeout(getPic(one.row));
        } catch {}
        status.done += 1;
        if (typeof url === 'string' && /^https?:\/\//.test(url)) {
          status.filled += 1;
          for (const key of one.keys) {
            if (!found.has(key)) found.set(key, new Map());
            found.get(key).set(one.id, url);
          }
          sinceSave += 1;
          if (sinceSave >= SAVE_EVERY) {
            sinceSave = 0;
            flush();
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
    flush();
    log.info?.(`[LX] covers: ${status.filled} of ${status.total} songs of the imported lists took a cover`);
  };

  /** Starts a fill in the background; a call while one runs makes it go over the lists once more after. */
  const start = () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await runOnce();
        } while (again);
      } catch (error) {
        log.warn?.('[LX] covers: the fill stopped', error);
      } finally {
        status = { ...status, running: false };
        running = null;
      }
    })();
    return running;
  };

  return { start, status: () => ({ ...status }), whenIdle: () => running || Promise.resolve() };
}

module.exports = { createLxCoverFill };

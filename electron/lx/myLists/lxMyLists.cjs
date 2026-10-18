const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// electron/lx/myLists/lxMyLists.cjs
// The lists imported from LX Music desktop's 「我的列表」 (./lxListFile.cjs reads the exported file),
// kept in userData/lx-my-lists/: index.json names them, lists/<key>.json holds each one's songs in
// LX's old music info shape (what lxNormalize.ts and the source script read). Folia's own local
// playlists hold only songs of the local library (LocalPlaylist.songIds), so LX online songs live
// here and reach the app as the playlists of the LX provider's library (lxProvider.ts).
//
// A list is known by the id LX gave it (`lxId`): importing a list with an id already kept replaces
// its name and songs, so importing the same export again updates rather than duplicates.

const KEY_PATTERN = /^[a-f0-9]{16}$/;
const keyOf = lxId => crypto.createHash('sha1').update(String(lxId)).digest('hex').slice(0, 16);
// The list's cover: its first song's, or where that has none, the first song's that has one.
const coverOf = songs => songs.find(song => typeof song.img === 'string' && /^https?:/.test(song.img))?.img || '';

function createLxMyLists({ baseDir, now = Date.now }) {
  let index = null; // { version, lists: [{ key, lxId, name, count, cover, importedAt, updatedAt }] }

  const dir = () => baseDir();
  const indexPath = () => path.join(dir(), 'index.json');
  const listPath = key => path.join(dir(), 'lists', `${key}.json`);

  const writeAtomic = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  };

  const load = () => {
    if (index) return index;
    try {
      const raw = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
      index = { version: 1, lists: Array.isArray(raw.lists) ? raw.lists.filter(list => list && KEY_PATTERN.test(list.key)) : [] };
    } catch {
      index = { version: 1, lists: [] };
    }
    return index;
  };
  const save = () => writeAtomic(indexPath(), JSON.stringify(index, null, 2));

  /** The lists kept, in the order they were first imported. */
  const list = () => load().lists.map(entry => ({ ...entry }));

  /** Every song of one list (old music info rows); [] for a list not kept. */
  const songsOf = key => {
    if (!KEY_PATTERN.test(String(key))) return [];
    try {
      const rows = JSON.parse(fs.readFileSync(listPath(key), 'utf8'));
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };

  const tracks = ({ key, offset = 0, limit = 500 }) => {
    const songs = songsOf(key);
    const start = Math.max(0, Number(offset) || 0);
    const size = Math.min(1000, Math.max(1, Number(limit) || 500));
    return { list: songs.slice(start, start + size), total: songs.length };
  };

  /**
   * Keeps the parsed lists (./lxListFile.cjs). A list with no online song is left out. Answers the
   * counts the settings page tells the listener.
   */
  const importLists = parsed => {
    const state = load();
    const at = now();
    let lists = 0;
    let songs = 0;
    let updated = 0;
    let skippedLocal = 0;
    let skippedOther = 0;
    let emptyLists = 0;
    for (const one of parsed.lists) {
      skippedLocal += one.skippedLocal;
      skippedOther += one.skippedOther;
      if (!one.songs.length) { emptyLists += 1; continue; }
      const key = keyOf(one.lxId);
      writeAtomic(listPath(key), JSON.stringify(one.songs));
      const entry = { key, lxId: one.lxId, name: one.name, count: one.songs.length, cover: coverOf(one.songs), updatedAt: at };
      const kept = state.lists.find(item => item.key === key);
      if (kept) {
        Object.assign(kept, entry);
        updated += 1;
      } else {
        state.lists.push({ ...entry, importedAt: at });
      }
      lists += 1;
      songs += one.songs.length;
    }
    save();
    return { lists, songs, updated, skippedLocal, skippedOther, emptyLists };
  };

  /**
   * Writes covers found later (./lxCoverFill.cjs) into a kept list: `covers` maps `<source>_<songmid>`
   * to an image URL. The list is read again here, so a list imported anew meanwhile is not undone:
   * only its rows that still have no cover take one. The list's cover follows its first song with one.
   * Answers how many rows took a cover.
   */
  const applyCovers = (key, covers) => {
    const state = load();
    const entry = state.lists.find(item => item.key === key);
    if (!entry) return 0;
    const songs = songsOf(key);
    let changed = 0;
    for (const song of songs) {
      if (song.img) continue;
      const url = covers.get(`${song.source}_${song.songmid}`);
      if (url) {
        song.img = url;
        changed += 1;
      }
    }
    if (!changed) return 0;
    writeAtomic(listPath(key), JSON.stringify(songs));
    entry.cover = coverOf(songs);
    save();
    return changed;
  };

  const remove = key => {
    const state = load();
    const before = state.lists.length;
    state.lists = state.lists.filter(item => item.key !== key);
    if (state.lists.length === before) return false;
    save();
    try { fs.rmSync(listPath(key), { force: true }); } catch {}
    return true;
  };

  return { list, tracks, songsOf, importLists, applyCovers, remove };
}

module.exports = { createLxMyLists, keyOf };

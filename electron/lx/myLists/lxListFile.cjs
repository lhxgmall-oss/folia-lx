const zlib = require('node:zlib');

// electron/lx/myLists/lxListFile.cjs
// Reads a list file exported from LX Music desktop (lx-music-desktop) into the lists Folia-LX keeps
// (./lxMyLists.cjs). LX writes these files with saveLxConfigFile (src/common/utils/nodejs.ts):
// JSON, gzip-compressed, extension .lxmc; a .json file is the same JSON uncompressed. The kinds read:
//
//   设置 → 备份与恢复 → 导出列表        { type: 'playList_v2', data: [{ id, name, list: [musicInfo] }] }
//   我的列表 → 右键 → 导出              { type: 'playListPart_v2', data: { id, name, list } }
//   设置 → 备份与恢复 → 导出全部数据    { type: 'allData_v2', setting, playList: [...] }
//   and the v1 ones of LX before 2.0:   'playList', 'playListPart', 'allData', 'defautlList' (sic)
//
// v2 rows are LX's new music info ({ id, name, singer, source, interval, meta: { songId, albumName,
// picUrl, qualitys, _qualitys, albumId, hash, strMediaMid, ... } }); v1 rows are the old one ({ songmid,
// name, singer, source, albumName, img, types, _types, hash, ... }). Folia-LX keeps the OLD shape: it is
// what the vendored musicSdk answers, what lxNormalize.ts reads (source + songmid) and what LX itself
// hands a custom source script for musicUrl (toOldMusicInfo). So v2 rows are turned back into it with
// LX's own toOldMusicInfo (src/common/utils/tools.ts), and v1 rows are kept as they are.
// Songs of the 'local' source (files on the listener's disk) are counted and left out.

const SUB_SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg'];
// LX's two built-in lists carry an i18n key as their name in exports.
const BUILT_IN_NAMES = Object.freeze({ list__name_default: '试听列表', list__name_love: '我的收藏' });
const BUILT_IN_BY_ID = Object.freeze({ default: '试听列表', love: '我的收藏' });

const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
const fail = message => Object.assign(new Error(message), { code: 'invalid-response' });

/** The JSON of a .lxmc (gzip) or .json file, as LX's readLxConfigFile reads it. */
function decodeLxFile(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let text;
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try { text = zlib.gunzipSync(bytes).toString('utf8'); } catch { throw fail('The file is not a valid .lxmc file (gzip could not be read)'); }
  } else {
    text = bytes.toString('utf8');
  }
  text = text.replace(/^\uFEFF/, '');
  let data;
  try { data = JSON.parse(text); } catch { throw fail('The file is not an LX Music list file (not JSON)'); }
  // LX 1.14.0 wrote some exports serialized twice.
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { throw fail('The file is not an LX Music list file'); }
  }
  if (!isObject(data)) throw fail('The file is not an LX Music list file');
  return data;
}

const fixQualities = (qualitys, _qualitys) => {
  const list = Array.isArray(qualitys) ? qualitys.map(q => (isObject(q) ? { ...q } : q)) : [];
  const map = isObject(_qualitys) ? { ..._qualitys } : {};
  if (map.flac32bit && !map.flac24bit) {
    map.flac24bit = map.flac32bit;
    delete map.flac32bit;
    for (const q of list) if (isObject(q) && q.type === 'flac32bit') q.type = 'flac24bit';
  }
  return { types: list, _types: map };
};

/** LX's toOldMusicInfo for an online song, with fixNewMusicInfoQuality applied. */
function v2ToOld(info) {
  const meta = isObject(info.meta) ? info.meta : {};
  const { types, _types } = fixQualities(meta.qualitys, meta._qualitys);
  const old = {
    name: info.name,
    singer: info.singer == null ? '' : info.singer,
    source: info.source,
    songmid: meta.songId,
    interval: info.interval,
    albumName: meta.albumName,
    img: meta.picUrl ?? '',
    typeUrl: {},
    albumId: meta.albumId,
    types,
    _types,
  };
  switch (info.source) {
    case 'kg':
      old.hash = meta.hash;
      old.albumAudioId = meta.albumAudioId;
      break;
    case 'tx':
      old.strMediaMid = meta.strMediaMid;
      old.albumMid = meta.albumMid;
      old.songId = meta.id;
      break;
    case 'mg':
      old.copyrightId = meta.copyrightId;
      old.lrcUrl = meta.lrcUrl;
      old.mrcUrl = meta.mrcUrl;
      old.trcUrl = meta.trcUrl;
      break;
  }
  return old;
}

/** A v1 row as it is, with the flac32bit fix toNewMusicInfo makes. */
function v1ToOld(info) {
  const { types, _types } = fixQualities(info.types, info._types);
  return { ...info, singer: info.singer == null ? '' : info.singer, img: info.img ?? '', types, _types };
}

const isV2Row = row => isObject(row.meta);

/**
 * One LX list into { lxId, name, songs (old music info), skippedLocal, skippedOther }. Songs without
 * a name or id, and repeats of one song, are dropped as LX's filterMusicList drops them.
 */
function convertList(raw, index) {
  const rows = Array.isArray(raw?.list) ? raw.list : [];
  const seen = new Set();
  const songs = [];
  let skippedLocal = 0;
  let skippedOther = 0;
  for (const row of rows) {
    if (!isObject(row)) { skippedOther += 1; continue; }
    if (row.source === 'local') { skippedLocal += 1; continue; }
    if (!SUB_SOURCES.includes(row.source)) { skippedOther += 1; continue; }
    const old = isV2Row(row) ? v2ToOld(row) : v1ToOld(row);
    if (old.songmid == null || old.songmid === '' || !old.name) { skippedOther += 1; continue; }
    const key = `${old.source}_${old.songmid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(JSON.parse(JSON.stringify(old)));
  }
  const lxId = raw?.id != null && raw.id !== '' ? String(raw.id) : `list_${index}`;
  const rawName = typeof raw?.name === 'string' ? raw.name.trim() : '';
  const name = BUILT_IN_NAMES[rawName] || rawName || BUILT_IN_BY_ID[lxId] || lxId;
  return { lxId, name, songs, skippedLocal, skippedOther };
}

/**
 * Parses an exported LX file. Answers { type, lists: [{ lxId, name, songs, skippedLocal, skippedOther }] }
 * or throws (code 'invalid-response') where the file is not a list export LX Music writes.
 */
function parseLxListFile(buffer) {
  const data = decodeLxFile(buffer);
  const type = typeof data.type === 'string' ? data.type : '';
  let rawLists;
  switch (type) {
    case 'playList':
    case 'playList_v2':
      rawLists = data.data;
      break;
    case 'playListPart':
    case 'playListPart_v2':
      rawLists = isObject(data.data) ? [data.data] : null;
      break;
    case 'allData':
      // LX 0.6.2 and before kept only the default list there.
      rawLists = Array.isArray(data.playList) ? data.playList
        : isObject(data.defaultList) ? [{ id: 'default', name: 'list__name_default', list: data.defaultList.list }] : null;
      break;
    case 'allData_v2':
      rawLists = data.playList;
      break;
    case 'defautlList':
      rawLists = isObject(data.data) ? [{ id: 'default', name: 'list__name_default', list: data.data.list }] : null;
      break;
    case 'setting':
    case 'setting_v2':
      throw fail('This is an LX Music settings file, not a list file');
    default:
      throw fail(`Not an LX Music list file (type: ${type || 'none'})`);
  }
  if (!Array.isArray(rawLists)) throw fail('The LX Music file holds no lists');
  return { type, lists: rawLists.filter(isObject).map(convertList) };
}

module.exports = { parseLxListFile, decodeLxFile, v2ToOld, v1ToOld, convertList, BUILT_IN_NAMES };

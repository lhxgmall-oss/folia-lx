// electron/lx/musicSdk/entry.js
// Bundle entry for the vendored LX Music musicSdk subset (search, song lists, lyrics, covers for
// kw/kg/tx/wy/mg). dev/lx/bundleMusicSdk.mjs bundles this into ./lxMusicSdk.cjs for the main process.
// The modules under ./src are copied from lyswhut/lx-music-desktop (Apache-2.0), see ./NOTICE.md.
import kwMusicSearch from './src/kw/musicSearch'
import kwSongList from './src/kw/songList'
import kwLyric from './src/kw/lyric'
import kwPic from './src/kw/pic'
import kgMusicSearch from './src/kg/musicSearch'
import kgSongList from './src/kg/songList'
import kgLyric from './src/kg/lyric'
import kgPic from './src/kg/pic'
import txMusicSearch from './src/tx/musicSearch'
import txSongList from './src/tx/songList'
import txLyric from './src/tx/lyric'
import wyMusicSearch from './src/wy/musicSearch'
import wySongList from './src/wy/songList'
import wyGetLyric from './src/wy/lyric'
import wyMusicDetail from './src/wy/musicDetail'
import mgMusicSearch from './src/mg/musicSearch'
import mgSongList from './src/mg/songList'
import mgLyric from './src/mg/lyric'
import mgPic from './src/mg/pic'
import { versionChars } from './src/versionChars'
import { setRequester } from './request'

const unwrap = value => (value && typeof value === 'object' && 'promise' in value ? value.promise : value)

// Same shape per source as lx-music-desktop's src/renderer/utils/musicSdk/<source>/index.js.
export const sources = {
  kw: {
    name: '酷我音乐',
    musicSearch: kwMusicSearch,
    songList: kwSongList,
    getLyric: songInfo => unwrap(kwLyric.getLyric(songInfo, true)),
    getPic: songInfo => unwrap(kwPic.getPic(songInfo)),
  },
  kg: {
    name: '酷狗音乐',
    musicSearch: kgMusicSearch,
    songList: kgSongList,
    getLyric: songInfo => unwrap(kgLyric.getLyric(songInfo)),
    getPic: songInfo => unwrap(kgPic.getPic(songInfo)),
  },
  tx: {
    name: 'QQ音乐',
    musicSearch: txMusicSearch,
    songList: txSongList,
    getLyric: songInfo => unwrap(txLyric.getLyric(songInfo)),
    getPic: async songInfo => `https://y.gtimg.cn/music/photo_new/T002R500x500M000${songInfo.albumId}.jpg`,
  },
  wy: {
    name: '网易音乐',
    musicSearch: wyMusicSearch,
    songList: wySongList,
    getLyric: songInfo => unwrap(wyGetLyric(songInfo.songmid)),
    getPic: songInfo => unwrap(wyMusicDetail.getList([songInfo.songmid])).then(res => res?.list?.[0]?.img || null),
  },
  mg: {
    name: '咪咕音乐',
    musicSearch: mgMusicSearch,
    songList: mgSongList,
    // Search answers often carry lrcUrl without mrcUrl; mg/lyric.js then re-reads the song info from an
    // endpoint that no longer answers, so an empty mrcUrl makes it use the lrcUrl it already has.
    getLyric: songInfo => unwrap(mgLyric.getLyric(songInfo.mrcUrl == null && songInfo.lrcUrl ? { ...songInfo, mrcUrl: '' } : songInfo)),
    getPic: songInfo => (songInfo.img ? Promise.resolve(songInfo.img) : unwrap(mgPic.getPic(songInfo))),
  },
}

export const SOURCE_IDS = Object.keys(sources)

export { setRequester, versionChars }

// Port of findMusic in lx-music-desktop's musicSdk/index.js: given a song from one source and the
// search lists of the others, picks the best match per list (name, singer, album, duration).
export const pickMatches = ({ name, singer, albumName, interval }, lists) => {
  const singersRxp = /、|&|;|；|\/|,|，|\|/
  const sortSingle = s => singersRxp.test(s) ? s.split(singersRxp).sort((a, b) => a.localeCompare(b)).join('、') : (s || '')
  const sortMusic = (arr, callback) => {
    const tempResult = []
    for (let i = arr.length - 1; i > -1; i--) {
      const item = arr[i]
      if (callback(item)) {
        delete item.fSinger
        delete item.fMusicName
        delete item.fAlbumName
        delete item.fInterval
        tempResult.push(item)
        arr.splice(i, 1)
      }
    }
    tempResult.reverse()
    return tempResult
  }
  const getIntv = value => {
    if (!value) return 0
    if (typeof value === 'number') return value
    const intvArr = String(value).split(':')
    let intv = 0
    let unit = 1
    while (intvArr.length) {
      intv += parseInt(intvArr.pop()) * unit
      unit *= 60
    }
    return intv
  }
  const trimStr = str => typeof str == 'string' ? str.trim() : (str || '')
  const filterStr = str => typeof str == 'string' ? str.replace(/\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[|!|！/g, '') : String(str || '')
  const fMusicName = filterStr(name).toLowerCase()
  const fSinger = filterStr(sortSingle(singer)).toLowerCase()
  const fAlbumName = filterStr(albumName).toLowerCase()
  const fInterval = getIntv(interval)
  const isEqualsInterval = intv => Math.abs((fInterval || intv) - (intv || fInterval)) <= 5
  const isEqualsVersionMusicNameChar = n => {
    for (const char of versionChars) {
      if (n.includes(char) != fMusicName.includes(char)) return false
    }
    return true
  }
  const isIncludesName = n => (fMusicName.includes(n) || n.includes(fMusicName)) && isEqualsVersionMusicNameChar(n)
  const isIncludesSinger = s => fSinger ? (fSinger.includes(s) || s.includes(fSinger)) : true
  const isEqualsAlbum = a => fAlbumName ? fAlbumName == a : true

  const result = lists.map(source => {
    const list = (source?.list || []).map(item => ({ ...item }))
    for (const item of list) {
      item.name = trimStr(item.name)
      item.singer = trimStr(item.singer)
      item.fSinger = filterStr(sortSingle(item.singer).toLowerCase())
      item.fMusicName = filterStr(String(item.name ?? '').toLowerCase())
      item.fAlbumName = filterStr(String(item.albumName ?? '').toLowerCase())
      item.fInterval = getIntv(item.interval)
      if (!isEqualsInterval(item.fInterval)) {
        item.name = null
        continue
      }
      if (item.fMusicName == fMusicName && isIncludesSinger(item.fSinger)) return item
    }
    for (const item of list) {
      if (item.name == null) continue
      if (item.fSinger == fSinger && isIncludesName(item.fMusicName)) return item
    }
    for (const item of list) {
      if (item.name == null) continue
      if (isEqualsAlbum(item.fAlbumName) && isIncludesSinger(item.fSinger) && isIncludesName(item.fMusicName)) return item
    }
    return null
  }).filter(s => s)
  const newResult = []
  if (result.length) {
    newResult.push(...sortMusic(result, item => item.fSinger == fSinger && item.fMusicName == fMusicName && item.interval == interval))
    newResult.push(...sortMusic(result, item => item.fMusicName == fMusicName && item.fSinger == fSinger && item.fAlbumName == fAlbumName))
    newResult.push(...sortMusic(result, item => item.fSinger == fSinger && item.fMusicName == fMusicName))
    newResult.push(...sortMusic(result, item => item.fMusicName == fMusicName && item.interval == interval))
    newResult.push(...sortMusic(result, item => item.fSinger == fSinger && item.interval == interval))
    newResult.push(...sortMusic(result, item => item.interval == interval))
    newResult.push(...sortMusic(result, item => item.fMusicName == fMusicName))
    newResult.push(...sortMusic(result, item => item.fSinger == fSinger))
    newResult.push(...sortMusic(result, item => item.fAlbumName == fAlbumName))
    for (const item of result) {
      delete item.fSinger
      delete item.fMusicName
      delete item.fAlbumName
      delete item.fInterval
    }
    newResult.push(...result)
  }
  return newResult
}

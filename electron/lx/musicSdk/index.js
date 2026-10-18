// electron/lx/musicSdk/index.js
// Stand-in for the helpers the vendored musicSdk imports from lx-music-desktop's
// src/renderer/utils/index.ts and src/common/utils (decodeName, formatPlayTime, sizeFormate, ...).
// Same behaviour, minus the DOM: decodeName decodes HTML entities by table instead of DOMParser.
// Only bundled (dev/lx/bundleMusicSdk.mjs), never loaded directly.
import crypto from 'crypto'

const namedEntities = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
}

export const decodeName = (str = '') => {
  if (!str) return ''
  return String(str).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole
    }
    const named = namedEntities[code.toLowerCase()]
    return named ?? whole
  })
}

const numFix = n => n < 10 ? (`0${n}`) : n.toString()

export const formatPlayTime = time => {
  let m = Math.trunc(time / 60)
  let s = Math.trunc(time % 60)
  return m === 0 && s === 0 ? '--/--' : numFix(m) + ':' + numFix(s)
}

export const formatPlayTime2 = time => {
  let m = Math.trunc(time / 60)
  let s = Math.trunc(time % 60)
  return numFix(m) + ':' + numFix(s)
}

export const sizeFormate = size => {
  if (!size) return '0 B'
  let units = ['B', 'KB', 'MB', 'GB', 'TB']
  let number = Math.floor(Math.log(size) / Math.log(1024))
  return `${(size / Math.pow(1024, Math.floor(number))).toFixed(2)} ${units[number]}`
}

export const formatPlayCount = num => {
  if (num > 100000000) return `${Math.trunc(num / 10000000) / 10}亿`
  if (num > 10000) return `${Math.trunc(num / 1000) / 10}万`
  return String(num)
}

export const dateFormat = (_date, format = 'Y-M-D h:m:s') => {
  const date = new Date(_date)
  if (!date) return ''
  return format
    .replace('Y', date.getFullYear())
    .replace('M', numFix(date.getMonth() + 1))
    .replace('D', numFix(date.getDate()))
    .replace('h', numFix(date.getHours()))
    .replace('m', numFix(date.getMinutes()))
    .replace('s', numFix(date.getSeconds()))
}

export const toMD5 = str => crypto.createHash('md5').update(str).digest('hex')

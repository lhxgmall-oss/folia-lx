// capacitor/lx/shims/path.js
// The part of node:path the LX bridge code uses, POSIX only (paths of the virtual file system, ./fs.js).
const normalize = value => {
  const absolute = value.startsWith('/')
  const out = []
  for (const part of value.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return (absolute ? '/' : '') + out.join('/')
}

export const sep = '/'
export const join = (...parts) => normalize(parts.filter(part => part !== '').join('/')) || '.'
export const resolve = (...parts) => normalize(['/', ...parts].join('/'))
export const dirname = value => {
  const normal = normalize(String(value))
  const index = normal.lastIndexOf('/')
  if (index < 0) return '.'
  return index === 0 ? '/' : normal.slice(0, index)
}
export const basename = (value, ext) => {
  const base = normalize(String(value)).split('/').pop() || ''
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base
}
export const extname = value => {
  const base = basename(value)
  const index = base.lastIndexOf('.')
  return index > 0 ? base.slice(index) : ''
}
export { normalize }
export const posix = { sep, join, resolve, dirname, basename, extname, normalize }
export default posix

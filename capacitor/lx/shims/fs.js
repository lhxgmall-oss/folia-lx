// capacitor/lx/shims/fs.js
// A synchronous file system in memory for the LX bridge code (userApiManager.cjs, lxMyLists.cjs), which
// reads and writes with fs.*Sync. On Android the files live in the app's data directory (Capacitor
// Filesystem): they are all read into memory before the bridge starts (mountVfs), and every write is
// handed to the persister, which writes it through in order. Writes to `*.tmp` stay in memory: the
// bridge code writes a temp file and renames it, and only the rename reaches the persister.
import { Buffer } from 'buffer'
import { normalize } from './path.js'

const files = new Map() // path -> string
let persister = null // { write(path, text), remove(path) }

const enoent = (syscall, file) => Object.assign(new Error(`ENOENT: no such file or directory, ${syscall} '${file}'`), { code: 'ENOENT', syscall, path: file })
const key = file => normalize(String(file))
const isTemp = file => file.endsWith('.tmp')
const asText = data => (typeof data === 'string' ? data : Buffer.from(data).toString('utf8'))

/** Fills the file system with `entries` ({ path: text }) and sets where writes go. */
export function mountVfs({ entries = {}, persist = null } = {}) {
  files.clear()
  for (const [file, text] of Object.entries(entries)) files.set(key(file), String(text))
  persister = persist
}

export function readFileSync(file, options) {
  const name = key(file)
  if (!files.has(name)) throw enoent('open', name)
  const text = files.get(name)
  const encoding = typeof options === 'string' ? options : options?.encoding
  return encoding ? text : Buffer.from(text, 'utf8')
}

export function writeFileSync(file, data) {
  const name = key(file)
  const text = asText(data)
  files.set(name, text)
  if (!isTemp(name)) persister?.write(name, text)
}

export function renameSync(from, to) {
  const source = key(from)
  const target = key(to)
  if (!files.has(source)) throw enoent('rename', source)
  const text = files.get(source)
  files.delete(source)
  files.set(target, text)
  if (!isTemp(source)) persister?.remove(source)
  if (!isTemp(target)) persister?.write(target, text)
}

export function rmSync(file, { force = false } = {}) {
  const name = key(file)
  if (!files.has(name)) {
    if (force) return
    throw enoent('rm', name)
  }
  files.delete(name)
  if (!isTemp(name)) persister?.remove(name)
}

export const unlinkSync = file => rmSync(file)
export const mkdirSync = () => undefined
export const existsSync = file => {
  const name = key(file)
  if (files.has(name)) return true
  const prefix = `${name}/`
  for (const other of files.keys()) if (other.startsWith(prefix)) return true
  return false
}
export const readdirSync = dir => {
  const prefix = `${key(dir)}/`
  const names = new Set()
  for (const other of files.keys()) if (other.startsWith(prefix)) names.add(other.slice(prefix.length).split('/')[0])
  return [...names]
}

export const promises = {
  readFile: async (file, options) => readFileSync(file, options),
  writeFile: async (file, data) => writeFileSync(file, data),
  stat: async file => {
    const name = key(file)
    if (!files.has(name)) throw enoent('stat', name)
    return { size: Buffer.byteLength(files.get(name)), isFile: () => true, isDirectory: () => false }
  },
}

export default { mountVfs, readFileSync, writeFileSync, renameSync, rmSync, unlinkSync, mkdirSync, existsSync, readdirSync, promises }

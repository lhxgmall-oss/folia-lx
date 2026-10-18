// capacitor/lx/shims/dns.js
// musicSdk/src/utils.js imports dns for a lookup cache the Android port never uses (Android's HTTP stack
// resolves names itself).
export const lookup = (hostname, options, callback) => {
  const done = typeof options === 'function' ? options : callback
  setTimeout(() => done?.(Object.assign(new Error('dns is not available'), { code: 'ENOTSUP' })), 0)
}
export default { lookup }

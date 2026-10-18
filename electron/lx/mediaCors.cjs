// electron/lx/mediaCors.cjs
// CORS for what the LX provider hands the page: the audio URLs a source script returned (any host,
// so only those exact URLs and where they redirect, for two hours), and covers from the five
// platforms' image hosts, which Web Audio / canvas read cross-origin. Same idea as
// electron/bodian/mediaCors.cjs.

const COVER_HOST_SUFFIXES = ['.kuwo.cn', '.kwcdn.kuwo.cn', '.kugou.com', '.kgimg.com', '.gtimg.cn', '.music.126.net', '.126.net', '.migu.cn'];

function createLxMediaPolicy({ now = Date.now } = {}) {
  const issuedUrls = new Map();
  const ttl = 2 * 60 * 60 * 1000;
  const normalize = value => {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      url.hash = '';
      return url;
    } catch { return null; }
  };
  const register = value => {
    const url = normalize(value);
    if (!url) return;
    issuedUrls.delete(url.href);
    issuedUrls.set(url.href, now() + ttl);
    while (issuedUrls.size > 2048) issuedUrls.delete(issuedUrls.keys().next().value);
  };
  const allows = details => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(details.method)) return false;
    const url = normalize(details.url);
    if (!url) return false;
    if (['media', 'xhr'].includes(details.resourceType)) {
      const expiry = issuedUrls.get(url.href);
      if (expiry > now()) return true;
      if (expiry !== undefined) issuedUrls.delete(url.href);
    }
    if (['image', 'xhr'].includes(details.resourceType)) {
      return COVER_HOST_SUFFIXES.some(suffix => url.hostname.endsWith(suffix));
    }
    return false;
  };
  return {
    register,
    allows,
    followRedirect(details) {
      if (allows(details)) register(details.redirectURL);
    },
  };
}

module.exports = { createLxMediaPolicy };

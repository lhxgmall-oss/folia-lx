const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

// electron/lx/lxHttp.cjs
// The HTTP request both LX halves go through: the vendored musicSdk (search, song lists, lyrics) and
// a custom source script's lx.request. Behaves like the `needle` calls lx-music-desktop makes:
// redirects are not followed unless asked (follow_max), the body comes back as text and is parsed as
// JSON where it parses, gzip/deflate/br answers are decoded.

const MAX_BODY_BYTES = 20 * 1024 * 1024;

const encodeForm = form => (typeof form === 'string' ? form : new URLSearchParams(
  Object.entries(form || {}).map(([key, value]) => [key, value == null ? '' : String(value)]),
).toString());

const encodeMultipart = formData => {
  const boundary = `----lxFormBoundary${crypto.randomBytes(8).toString('hex')}`;
  const parts = [];
  for (const [key, value] of Object.entries(formData || {})) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n`));
    parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value == null ? '' : String(value)));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
};

const hasHeader = (headers, name) => Object.keys(headers).some(key => key.toLowerCase() === name);

// Turns the needle-style options into a method, headers and a body buffer.
function buildRequestBody(options) {
  const headers = { ...(options.headers || {}) };
  let body = null;
  if (options.body != null) {
    if (Buffer.isBuffer(options.body) || typeof options.body === 'string') {
      body = Buffer.from(options.body);
    } else {
      body = Buffer.from(JSON.stringify(options.body));
      if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json';
    }
  } else if (options.form != null) {
    body = Buffer.from(encodeForm(options.form));
    if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (options.formData != null) {
    const multipart = encodeMultipart(options.formData);
    body = multipart.body;
    headers['Content-Type'] = multipart.contentType;
  }
  if (body) headers['Content-Length'] = String(body.length);
  return { method: String(options.method || 'get').toUpperCase(), headers, body };
}

const decode = (raw, encoding) => {
  try {
    switch (String(encoding || '').toLowerCase()) {
      case 'gzip': return zlib.gunzipSync(raw);
      case 'deflate': try { return zlib.inflateSync(raw); } catch { return zlib.inflateRawSync(raw); }
      case 'br': return zlib.brotliDecompressSync(raw);
      default: return raw;
    }
  } catch {
    return raw;
  }
};

/**
 * One request. `options`: method, headers, body | form | formData, timeout (ms), follow_max.
 * Answers { promise, abort }; the promise resolves to
 * { statusCode, statusMessage, headers, bytes, raw, body } (body: parsed JSON or text).
 */
function lxRequest(url, options = {}, { transports = { http, https } } = {}) {
  let current = null;
  let aborted = false;
  const timeout = typeof options.timeout === 'number' && options.timeout > 0 ? Math.min(options.timeout, 60_000) : 15_000;
  const followMax = Number.isInteger(options.follow_max) ? options.follow_max : 0;

  const promise = new Promise((resolve, reject) => {
    const send = (target, redirectsLeft) => {
      let parsed;
      try { parsed = new URL(target); } catch (error) { reject(error); return; }
      if (!['http:', 'https:'].includes(parsed.protocol)) { reject(new Error(`Unsupported protocol: ${parsed.protocol}`)); return; }
      const transport = parsed.protocol === 'https:' ? transports.https : transports.http;
      const { method, headers, body } = buildRequestBody(options);
      const request = transport.request(parsed, { method, headers }, response => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location && redirectsLeft > 0) {
          response.resume();
          send(new URL(response.headers.location, parsed).href, redirectsLeft - 1);
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) { request.destroy(new Error('Response too large')); return; }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          const raw = decode(Buffer.concat(chunks), response.headers['content-encoding']);
          const text = raw.toString();
          let parsedBody = text;
          try { parsedBody = JSON.parse(text); } catch {}
          resolve({
            statusCode: status,
            statusMessage: response.statusMessage,
            headers: response.headers,
            bytes: raw.length,
            raw,
            body: parsedBody,
          });
        });
      });
      current = request;
      request.setTimeout(timeout, () => {
        const error = new Error('Request timed out');
        error.code = 'ETIMEDOUT';
        request.destroy(error);
      });
      request.on('error', error => reject(aborted ? Object.assign(new Error('Request cancelled'), { code: 'ECANCELLED' }) : error));
      if (body) request.write(body);
      request.end();
    };
    send(url, followMax);
  });

  return {
    promise,
    abort() {
      aborted = true;
      current?.destroy();
    },
  };
}

module.exports = { lxRequest, buildRequestBody, encodeForm };

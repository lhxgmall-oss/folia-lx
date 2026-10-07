"use strict";

// shared/networkErrorText.cjs
// 网络错误文字的识别与脱敏，Electron 主进程用；渲染进程用 shared/networkErrorText.mjs，两份内容须保持一致
// （test/unit/shared/networkErrorText.test.ts 对照两份的输出）。
// - 连接被重置：上游 request 只把 err.message 放进 { code: 502, msg }，丢了 err.code，只能按文字认。
// - IP 脱敏：错误文字里的地址换成「协议族 + 类别」，端口保留。是不是本机代理（127.0.0.1:7890）、
//   Clash fake-ip（198.18.0.0/15）、Teredo 隧道这些是排查时要的，地址本身不要。

// Node 里 code 为 ECONNRESET 的几种 message：读时被重置、对端直接挂断、TLS 握手前被断开。
const CONNECTION_RESET_PATTERN = /ECONNRESET|socket hang up|socket disconnected before secure TLS connection/i;

/** 错误文字是否表示连接被对端重置。 */
const isConnectionResetMessage = (text) => CONNECTION_RESET_PATTERN.test(String(text ?? ''));

const IPV4_PATTERN = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?(?!\d|\.\d)/g;
// IPv6 候选：至少两个冒号的十六进制串；是否真是地址由 parseIpv6 判定（排除 12:00:00 这类时刻）。
const IPV6_CANDIDATE_PATTERN = /(?<![0-9A-Za-z:.])[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,8}(?::\d{1,3}(?:\.\d{1,3}){3})?(?![0-9A-Za-z:]|\.\d)/g;

const classifyIpv4 = (a, b) => {
  if (a === 127) return 'loopback';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  if (a === 169 && b === 254) return 'link-local';
  // 198.18.0.0/15 是基准测试保留段，Clash 等代理的 fake-ip 默认用它。
  if (a === 198 && (b === 18 || b === 19)) return 'fake-ip';
  if (a === 0) return 'unspecified';
  return 'public';
};

// 解析成 8 个 16 位分组；不是合法 IPv6 时返回 null。
const parseIpv6 = (text) => {
  let body = text;
  let tail = [];
  // 末尾内嵌的 IPv4（::ffff:1.2.3.4）占两个分组。
  const v4 = /(?:^|:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some(octet => octet > 255)) return null;
    tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    body = text.slice(0, v4.index);
    if (body.endsWith(':')) body = `${body}:`;
  }
  const halves = body.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part) => (part ? part.split(':') : []);
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if ([...head, ...rest].some(group => !/^[0-9A-Fa-f]{1,4}$/.test(group))) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1 ? known !== 8 : known > 7) return null;
  const zeros = new Array(8 - known).fill(0);
  return [...head.map(g => parseInt(g, 16)), ...zeros, ...rest.map(g => parseInt(g, 16)), ...tail];
};

const classifyIpv6 = (groups) => {
  if (groups.every(group => group === 0)) return { family: 'ipv6', category: 'unspecified' };
  if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) return { family: 'ipv6', category: 'loopback' };
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    return { family: 'ipv4-mapped', category: classifyIpv4(groups[6] >> 8, groups[6] & 0xff) };
  }
  if ((groups[0] & 0xffc0) === 0xfe80) return { family: 'ipv6', category: 'link-local' };
  if ((groups[0] & 0xfe00) === 0xfc00) return { family: 'ipv6', category: 'private' };
  if (groups[0] === 0x2001 && groups[1] === 0) return { family: 'ipv6', category: 'teredo' };
  if (groups[0] === 0x2002) return { family: 'ipv6', category: '6to4' };
  return { family: 'ipv6', category: 'public' };
};

// Node 的连接错误把端口直接接在 IPv6 地址后面（不带方括号）：整串不是地址、去掉末段十进制后是地址时，末段按端口算；
// 整串本身就合法时（例如 ::1:7890），末段是十进制且去掉后仍合法，也按端口算——错误文字里的地址几乎总带端口。
const describeIpv6Candidate = (candidate) => {
  const portMatch = /:(\d{1,5})$/.exec(candidate);
  if (portMatch && Number(portMatch[1]) <= 65535) {
    const groups = parseIpv6(candidate.slice(0, portMatch.index));
    if (groups) return { ...classifyIpv6(groups), port: portMatch[1] };
  }
  const groups = parseIpv6(candidate);
  return groups ? { ...classifyIpv6(groups), port: null } : null;
};

/**
 * 把文字里的 IPv4 / IPv6 地址换成 `<族-类别>`，端口保留，例如 `<ipv4-loopback>:7890`、`<ipv6-teredo>:443`。
 * 先换 IPv6：::ffff:1.2.3.4 这类映射地址要整体识别，不能先被 IPv4 规则拆开。
 */
const redactIpAddresses = (text) => String(text ?? '')
  .replace(IPV6_CANDIDATE_PATTERN, (match) => {
    const described = describeIpv6Candidate(match);
    if (!described) return match;
    return `<${described.family}-${described.category}>${described.port ? `:${described.port}` : ''}`;
  })
  .replace(IPV4_PATTERN, (match, a, b, c, d, port) => {
    const octets = [a, b, c, d].map(Number);
    if (octets.some(octet => octet > 255)) return match;
    return `<ipv4-${classifyIpv4(octets[0], octets[1])}>${port ? `:${port}` : ''}`;
  });

module.exports = {
  isConnectionResetMessage,
  redactIpAddresses,
};

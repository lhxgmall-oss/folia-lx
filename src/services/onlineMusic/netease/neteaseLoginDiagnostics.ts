import type { LoginDiagnosticLine } from '../../../types/onlineMusic';
import { diagnosticLine, formatDiagnosticClock } from '../login/loginDiagnosticReport';
import { formatBackendApp, formatBackendStartup, formatConnection, formatRecentConnections, readBackendSnapshot } from '../login/loginBackendDiagnostics';
import { readProviderSessionValue } from '../providerStorage';

// src/services/onlineMusic/netease/neteaseLoginDiagnostics.ts
// 网易扫码登录诊断报告里的 provider 专属部分。真正有用的现场在 Electron 主进程：上游会把网易的
// 真实返回码吞成 404，只有主进程的请求层记下了它（electron/netease/neteaseLoginDiagnostics.cjs）。

type NeteaseLoginSession = {
    hasLoginCookie: boolean;
    hasAnonymousCookie: boolean;
    // 最近一次读登录状态的结论（neteaseProvider.ts 记下的：哪个接口、回的码）；没读过时没有。
    lastAccountCheck?: LoginDiagnosticLine | null;
};

const yesNo = (value: boolean | undefined): string => (value === undefined ? 'unknown' : value ? 'yes' : 'no');

// 网易自己的上游域名：连接记录里只印这些，别的（代理、别人的服务器）印 <host>。
const isNeteaseHost = (host: string): boolean => /(?:^|\.)(?:163\.com|126\.net|netease\.com)$/i.test(host);

// electron/netease/neteaseBackend.cjs 的 LISTEN_HOST：本地后端固定听在这里。
const NETEASE_LISTEN_HOST = '127.0.0.1';

// 链路本地（fe80::）、唯一本地（fc00::/7）和回环不算公网 IPv6。
const isGlobalIpv6 = (address: { address: string; family: 4 | 6 }): boolean => (
    address.family === 6 && !/^(?:fe[89ab]|f[cd]|::1$)/i.test(address.address)
);

// 本地后端听在哪里，只说是哪一种：地址本身不进报告。
const listenKind = (host: string | undefined): LoginDiagnosticLine => {
    if (host === undefined) return diagnosticLine`?`;
    if (host === '127.0.0.1') return diagnosticLine`loopback-v4`;
    if (host === '::1') return diagnosticLine`loopback-v6`;
    return host === 'localhost' ? diagnosticLine`localhost` : diagnosticLine`other`;
};

// 系统给网卡起名字用的词（Wi-Fi、Ethernet 2、vEthernet (WSL)、en0、enp0s31f6、tailscale0），和几种代理、抓包
// 软件自己装的网卡的名字（Mihomo、Clash、Meta、Npcap、Radmin）。iPhone、iPad、Android、Hotspot 不在里面：
// 系统不拿这些词给网卡起名字，带着它们的名字是某个人的设备的名字。
const ADAPTER_WORDS = new Set((
    'wi fi wifi wlan wwan ethernet vethernet lan local area connection network adapter bluetooth loopback pseudo interface default external switch virtual '
    + 'vmware vmnet virtualbox host only hyper wsl firewall tailscale zerotier wireguard openvpn wintun tap tun tunnel tunneling windows usb thunderbolt bridge docker nat vpn '
    + 'cellular mobile broadband teredo isatap npcap radmin mihomo clash meta '
    + 'lo en eth em eno ens enp enx np wl wlo wlp wlx ww wwp utun awdl llw br veth virbr vnet wg zt ap anpi gif stf vboxnet ppp rmnet bond team dummy vlan vxlan pan ipsec '
    + 'lxcbr lxdbr cni flannel podman ib pktap xhc fw'
).split(' '));
const ADAPTER_WORDS_CN = new Set(['以太网', '本地连接', '网络连接', '无线网络连接', '蓝牙网络连接', '无线局域网', '移动宽带']);

/**
 * 一块网卡的名字在报告里印什么。规矩只有一条：名字里的每一个词都是系统给网卡起名字用的词、单个字母
 * 或者数字，才印名字；别的名字是谁起的说不准（某某的 iPhone、LiHua-PC，系统拿设备和主人的名字起的），
 * 印 <device>。带撇号的名字也印 <device>：那是「某某的」（Nat's Wi-Fi）。印的时候数字和字母分开交给
 * diagnosticLine：连在一起的 enp0s31f6、bridge100 会被洗文字的规则当成一长串凭据。
 */
const interfaceName = (name: string): LoginDiagnosticLine => {
    const words = name.match(/[A-Za-z]+|[^\x00-\x7F]+/g) ?? [];
    const known = /\S/.test(name) && !name.includes("'")
        && words.every(word => (/^[A-Za-z]/.test(word) ? word.length === 1 || ADAPTER_WORDS.has(word.toLowerCase()) : ADAPTER_WORDS_CN.has(word)));
    if (!known) return diagnosticLine`<device>`;
    return name.trim().split(/\s+/)
        .map(part => (part.match(/\d+|\D+/g) ?? []).map(piece => diagnosticLine`${piece}`).reduce((joined, piece) => diagnosticLine`${joined}${piece}`))
        .reduce((joined, part) => diagnosticLine`${joined} ${part}`);
};

const formatRequest = (request: ElectronNeteaseLoginRequestRecord): LoginDiagnosticLine[] => {
    const { outcome } = request;
    // 接口的路径不带开头的斜线：带着它，洗文字的规则会把它当成一条文件路径换掉。
    const route = request.uri.replace(/^\/+/, '');
    const message = outcome.message ? diagnosticLine` msg="${outcome.message}"` : '';
    const duration = request.durationMs === null ? '' : diagnosticLine` ${request.durationMs}ms`;
    // 下面几行是这次请求打开的连接：连上了哪一族地址、断在 TCP 还是 TLS。
    return [diagnosticLine`  ${formatDiagnosticClock(request.at)} ${route} ${outcome.settled} status=${outcome.status} code=${outcome.code}${message}${duration} ip-header=${request.ipHeader} device=…${request.deviceIdTail || '-'} MUSIC_U=${yesNo(request.hasMusicU)} MUSIC_A=${yesNo(request.hasMusicA)}`,
        ...(request.connections ?? []).map(connection => diagnosticLine`      ↳ ${formatConnection(connection, isNeteaseHost, false)}`)];
};

// 把主进程快照和渲染进程会话状态排成报告行；纯函数，便于测试。每一行都由 diagnosticLine 写：
// 从主进程来的每一段文字（请求的路径、网易的原话、本地后端抛出的那句话、网卡的名字）它都先洗过。
export const formatNeteaseLoginDiagnostics = (
    snapshot: ElectronNeteaseLoginDiagnostics | null,
    session: NeteaseLoginSession,
    // 去主进程取快照失败时的那一行（snapshot 这时为 null）。
    unavailable: LoginDiagnosticLine | null = null,
): LoginDiagnosticLine[] => {
    const lines = [
        diagnosticLine`session: login cookie=${yesNo(session.hasLoginCookie)}, anonymous cookie=${yesNo(session.hasAnonymousCookie)}`,
        ...(session.lastAccountCheck === undefined ? [] : [diagnosticLine`last account check: ${session.lastAccountCheck ?? 'none'}`]),
    ];
    if (!snapshot) {
        return [unavailable ?? diagnosticLine`runtime: web (remote API, no main-process record)`, ...lines];
    }

    const { app, backend, startup, login, identity } = snapshot;
    // login 为 null：上游包没加载起来（startup 里 load 那一步失败），没有登录请求与网卡的记录。
    const network = login?.network ?? { interfaces: [] };
    const requests = login?.requests ?? [];
    const addresses = network.interfaces.flatMap(item => item.addresses);
    // 一块网卡一段，各洗各的：整串当成一个值的话，网卡多了会在 160 字处被截断。名字印什么见 interfaceName；地址本身不进报告。
    const interfaces = network.interfaces
        .map(item => diagnosticLine`${interfaceName(item.name)}[${[item.addresses.some(address => address.family === 4) ? 'v4' : '', item.addresses.some(isGlobalIpv6) ? 'v6' : ''].filter(Boolean).join(',') || '-'}]`)
        .reduce<LoginDiagnosticLine | null>((joined, line) => (joined ? diagnosticLine`${joined}, ${line}` : line), null);
    const deviceTails = [...new Set(requests.map(request => request.deviceIdTail).filter(Boolean))];
    // 主进程与渲染进程不同版（开发时只热更了一边）时缺的一段印一行 unknown，报告照出。
    const lastRun = startup?.at(-1);
    return [
        diagnosticLine`runtime: electron (local API)`,
        ...formatBackendApp(app),
        backend
            ? diagnosticLine`local api: ${backend.status} ${listenKind(NETEASE_LISTEN_HOST)}:${backend.port}${backend.offline ? diagnosticLine` offline` : ''}${backend.error ? diagnosticLine` error="${backend.error}"` : ''}`
            : diagnosticLine`local api: unknown`,
        diagnosticLine`startup: anonymous token at load=${login?.startup?.anonymousTokenAtLoad ?? 'unknown'}, runs=${startup?.length ?? 'unknown'}, last run=${lastRun?.outcome ?? 'none'}`,
        ...formatBackendStartup(startup),
        ...(login ? [] : [diagnosticLine`upstream package: not loaded (see the load step above)`]),
        network.error
            ? diagnosticLine`network: error ${network.error}`
            : diagnosticLine`network: global IPv6 addresses=${addresses.filter(isGlobalIpv6).length}; interfaces: ${interfaces ?? 'none'}`,
        ...(identity ? [diagnosticLine`identity: connection resets=${identity.connectionResets}, rotations=${identity.rotations}, last token renewed=${identity.lastTokenRenewed === null ? 'unknown' : yesNo(identity.lastTokenRenewed)}, pending rotation=${yesNo(identity.pendingRotation)}, process started ${new Date(identity.processStartedAt).toISOString()}, last rotation ${identity.lastRotatedAt === null ? 'none' : formatDiagnosticClock(identity.lastRotatedAt)}`] : []),
        ...lines,
        // 同一轮扫码里 deviceId 变过，是已知的一个可疑点（渲染进程注册匿名身份会改掉主进程的全局 deviceId）。
        diagnosticLine`device ids seen in login requests: ${deviceTails.length}`,
        diagnosticLine`login requests (${requests.length}, oldest first, UTC):`,
        ...(requests.length > 0 ? requests.flatMap(formatRequest) : [diagnosticLine`  (none)`]),
        // 不属于哪一次登录请求的连接，例如拉起时取 xeapi 公钥。
        ...formatRecentConnections('other upstream connections', snapshot.connections, isNeteaseHost),
    ];
};

// 收集网易扫码登录的诊断行。Web 端没有主进程可问，只报会话状态。`lastAccountCheck`：最近一次读登录状态的结论。
export const collectNeteaseLoginDiagnostics = async (lastAccountCheck: LoginDiagnosticLine | null = null): Promise<LoginDiagnosticLine[]> => {
    const session = {
        hasLoginCookie: Boolean(readProviderSessionValue('netease', 'cookie', ['netease_cookie'])),
        hasAnonymousCookie: Boolean(readProviderSessionValue('netease', 'anonymous_cookie', ['netease_anonymous_cookie'])),
        lastAccountCheck,
    };
    const { snapshot, failure } = await readBackendSnapshot('netease');
    return formatNeteaseLoginDiagnostics(snapshot?.providerId === 'netease' ? snapshot : null, session, failure);
};

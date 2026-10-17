import { describe, expect, it, vi } from 'vitest';
import { buildLoginIssueUrl, diagnosticLine, formatLoginDiagnosticReport, formatLoginSelfCheck } from '@/services/onlineMusic/login/loginDiagnosticReport';
import { formatNeteaseLoginDiagnostics } from '@/services/onlineMusic/netease/neteaseLoginDiagnostics';
import { formatQqLoginDiagnostics } from '@/services/onlineMusic/qq/qqLoginDiagnostics';
import { loginCaseOf, loginFailureFacts } from '@/services/onlineMusic/login/loginFailureCase';
import { omni } from '@/services/onlineMusic/omni';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import type { LoginDiagnosticLine, LoginSelfCheckResult } from '@/types/onlineMusic';

// test/unit/login/loginDiagnosticReport.test.ts

const AT = Date.UTC(2026, 8, 26, 12, 0, 0);

type Netease = ElectronNeteaseLoginDiagnostics;
type Login = NonNullable<Netease['login']>;

// What a network interface carries, as the main process lists it: an IPv4 address, a global IPv6 one.
const interfacesOf = (items: Array<{ name: string; ipv4: boolean; globalIpv6: boolean }>): Login['network'] => ({
    interfaces: items.map(({ name, ipv4, globalIpv6 }) => ({
        name,
        addresses: [
            ...(ipv4 ? [{ address: '192.0.2.10', family: 4 as const }] : []),
            ...(globalIpv6 ? [{ address: '2001:db8::10', family: 6 as const }] : []),
            { address: 'fe80::1', family: 6 as const },
        ],
    })),
});

const login: Login = {
    capturedAt: AT,
    startup: { anonymousTokenAtLoad: 'present' },
    network: { interfaces: [{ name: 'Wi-Fi', addresses: [{ address: '192.0.2.10', family: 4 }, { address: '2001:db8::10', family: 6 }, { address: '2001:db8::11', family: 6 }] }] },
    requests: [{
        at: AT,
        uri: '/api/login/qrcode/client/login',
        crypto: '',
        ipHeader: 'none',
        deviceIdTail: 'ABCDEF',
        hasMusicU: false,
        hasMusicA: true,
        durationMs: 140,
        outcome: { settled: 'rejected', status: 400, code: 8821, message: '需要行为验证码验证' },
        connections: [],
    }],
};

const snapshot: Netease = {
    providerId: 'netease',
    capturedAt: AT,
    app: { version: '1.2.3', electron: '38.0.0', platform: 'win32', arch: 'x64', osRelease: '10.0.22631' } as ElectronAppEnvironment,
    backend: { status: 'running', port: 52001, error: null, updatedAt: AT },
    startup: [],
    login,
    identity: null,
    connections: [],
};

const reportOf = (providerLines: readonly unknown[]): string => formatLoginDiagnosticReport({
    generatedAt: AT, appVersion: '1.2.3', userAgent: 'test-agent', providerId: 'netease', methodId: null, failure: 'check-error', timeline: [],
    providerLines: providerLines as LoginDiagnosticLine[],
});

// Made-up private text: a user's folder, a credential, an address with a query, an IP, an account.
const PRIVATE = {
    path: "EPERM: operation not permitted, open 'C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\ncm\\anonymous_token'",
    token: 'refused MUSIC_U=00A1B2C3D4E5F607ABCD for uin 2873651094',
    address: 'request to https://music.example.test/login/qr/check?key=qr-private-1 from 203.0.113.7 failed',
};
// A start-up run and a connection with private text in every field that comes from outside.
const privateStartup: ElectronBackendStartupRun = {
    startedAt: AT,
    finishedAt: AT + 5,
    outcome: PRIVATE.address,
    steps: [{ id: PRIVATE.token, startedAt: AT, durationMs: 5, outcome: 'failed', detail: { file: PRIVATE.path, uin: 2873651094 }, error: PRIVATE.path }],
};
const privateConnection: ElectronNetworkConnection = {
    at: AT,
    method: 'POST',
    host: 'proxy.example.test',
    path: '/login/qr/check/qr-private-1/2873651094',
    dns: [{ address: '203.0.113.7', family: 4 }],
    dnsError: { code: 'ENOTFOUND', message: PRIVATE.address },
    attempts: [{ address: '203.0.113.7', family: 4, outcome: 'failed', error: { code: 'ECONNREFUSED', message: PRIVATE.address } }, { address: '203.0.113.8', family: 4, outcome: 'connected', error: null }],
    remote: { address: '203.0.113.8', family: 4 },
    reusedSocket: false,
    connectMs: 3,
    tlsMs: null,
    responseMs: null,
    totalMs: 9,
    status: null,
    error: { code: 'ECONNRESET', message: PRIVATE.address, phase: 'tls' },
};
const LEFT_OF_PRIVATE = /Zhang|San\b|AppData|anonymous_token|00A1B2C3|2873651094|example\.test|qr-private|203\.0\.113/;

describe('QR login diagnostic report', () => {
    it('lays out the main-process record so the swallowed NetEase code is visible', () => {
        const lines = formatNeteaseLoginDiagnostics(snapshot, { hasLoginCookie: false, hasAnonymousCookie: true }).map(line => line.text);

        expect(lines).toContain('runtime: electron (local API)');
        expect(lines).toContain('app: 1.2.3 electron 38.0.0 win32 x64 (10.0.22631)');
        // Where the local API listens is told as a kind, not as an address.
        expect(lines).toContain('local api: running loopback-v4:52001');
        expect(lines).toContain('session: login cookie=no, anonymous cookie=yes');
        expect(lines).toContain('network: global IPv6 addresses=2; interfaces: Wi-Fi[v4,v6]');
        // The route stands without its leading slash: with it the cleaner takes it for a file path.
        expect(lines).toContain(
            '  12:00:00.000 api/login/qrcode/client/login rejected status=400 code=8821 msg="需要行为验证码验证" 140ms ip-header=none device=…ABCDEF MUSIC_U=no MUSIC_A=yes',
        );
    });

    it('says plainly when there is no main process to ask', () => {
        expect(formatNeteaseLoginDiagnostics(null, { hasLoginCookie: false, hasAnonymousCookie: false })[0].text)
            .toBe('runtime: web (remote API, no main-process record)');
    });

    // The high finding of the second check: what the main process hands over (the local service's
    // thrown sentence, a platform's message, a request's address) went into the report unread.
    describe('what a platform adds to the report', () => {
        it('is cleaned value by value, and the words the platform\'s code wrote stay', () => {
            const line = diagnosticLine`check status=${200} cookie=${'yes'} error="${PRIVATE.path}" said="${PRIVATE.token}" at ${PRIVATE.address}`;
            expect(line.text).toBe('check status=200 cookie=yes error="EPERM: operation not permitted, open \'<path>\'" said="refused MUSIC_U=<value> for uin <number>" at request to <address> from <ip> failed');
            expect(diagnosticLine`a=${null} b=${undefined} c=${''} d=${true}${diagnosticLine` e="${'uin 2873651094'}"`}`.text).toBe('a=- b=- c= d=true e="uin <number>"');
        });

        // Every platform that declares diagnostics has a row here: its builder is fed private text
        // in every field that comes from outside it. A new platform's diagnostics fail the first
        // assertion until it has a row.
        it('holds nothing private, for every platform that adds lines of its own', () => {
            const builders: Record<string, () => LoginDiagnosticLine[]> = {
                // Every field the main process hands over as text, also the ones its type says are one of a few words.
                netease: () => formatNeteaseLoginDiagnostics({
                    ...snapshot,
                    app: { version: PRIVATE.token, electron: PRIVATE.address, platform: PRIVATE.path, arch: PRIVATE.token, osRelease: PRIVATE.path } as ElectronAppEnvironment,
                    backend: { status: PRIVATE.token as never, port: null, error: PRIVATE.path, updatedAt: AT },
                    startup: [privateStartup],
                    connections: [privateConnection, { ...privateConnection, host: 'interfacepc.music.163.com' }],
                    login: {
                        ...login,
                        startup: { anonymousTokenAtLoad: PRIVATE.address as never },
                        network: { interfaces: [{ name: PRIVATE.address, addresses: [{ address: '203.0.113.7', family: 4 }] }, { name: "Zhang San's iPhone", addresses: [{ address: '203.0.113.8', family: 4 }] }] },
                        requests: [
                            {
                                ...login.requests[0], uri: '/api/login/qrcode/client/login?key=qr-private-1&uin=2873651094', deviceIdTail: '2873651094', ipHeader: PRIVATE.address as never,
                                outcome: { settled: PRIVATE.token as never, status: null, code: PRIVATE.token, message: PRIVATE.address },
                                connections: [privateConnection],
                            },
                            { ...login.requests[0], uri: 'C:\\Users\\Zhang San\\AppData', outcome: { settled: 'rejected', status: 502, code: null, message: `Error: ${PRIVATE.path}` } },
                        ],
                    },
                }, { hasLoginCookie: true, hasAnonymousCookie: true }),
                // The channel names come from the backend; the last account check is a line of its own.
                qq: () => formatQqLoginDiagnostics({
                    hasSession: true,
                    channels: [PRIVATE.token, PRIVATE.address],
                    lastAccountCheck: diagnosticLine`failed: ${PRIVATE.path}`,
                }, {
                    providerId: 'qq',
                    capturedAt: AT,
                    app: { ...snapshot.app, credentialStore: { error: PRIVATE.path } },
                    backend: { status: PRIVATE.token as never, port: 41057, error: PRIVATE.path, updatedAt: AT },
                    version: PRIVATE.token,
                    startup: [privateStartup],
                    hooks: { installed: [PRIVATE.address], error: PRIVATE.path },
                    failures: [{
                        at: AT, kind: 'session', stage: PRIVATE.token, channel: PRIVATE.address, sessionState: PRIVATE.path,
                        error: { message: PRIVATE.token, uin: 2873651094, cause: PRIVATE.address, stack: [`at load (${PRIVATE.path})`] },
                    }],
                    authEvents: [
                        { at: AT, level: 'warn', event: PRIVATE.address, details: { uin: '2873651094', said: PRIVATE.token } },
                        { at: AT, level: 'info', event: 'qq-auth.note', details: PRIVATE.path },
                    ],
                    connections: [privateConnection, { ...privateConnection, host: 'u.y.qq.com' }],
                }),
            };
            const declaring = listOnlineMusicProviders().filter(provider => provider.auth?.getLoginDiagnostics).map(provider => provider.id);
            expect(Object.keys(builders).sort()).toEqual(declaring.sort());
            for (const [providerId, build] of Object.entries(builders)) {
                const report = reportOf(build());
                expect(report, providerId).not.toMatch(LEFT_OF_PRIVATE);
            }
            // The structure is still there to read.
            const netease = reportOf(builders.netease());
            expect(netease).toMatch(/status=502 code=- msg="Error: EPERM: operation not permitted, open '<path>'"/);
            expect(netease).toContain('local api: refused MUSIC_U=<value> for uin <number> loopback-v4:- error="EPERM: operation not permitted, open \'<path>\'"');
            expect(reportOf(builders.qq())).toContain("last account check: failed: EPERM: operation not permitted, open '<path>'");
        });

        it('keeps a long list of network interfaces whole, a start-up error of several lines on its line, and a kernel release readable', () => {
            const names = ['Wi-Fi', '以太网', 'vEthernet (WSL (Hyper-V firewall))', 'vEthernet (Default Switch)', 'VMware Network Adapter VMnet1', 'VMware Network Adapter VMnet8', 'Tailscale', '蓝牙网络连接', 'Loopback Pseudo-Interface 1', '李华的 iPhone'];
            const lines = formatNeteaseLoginDiagnostics({
                ...snapshot,
                app: { ...snapshot.app, platform: 'linux', arch: 'arm64', osRelease: '6.8.0-45-generic' },
                backend: { status: 'error', port: null, error: "Cannot find module '@neteasecloudmusicapienhanced/api'\nRequire stack:\n- /opt/Folia/resources/app.asar/electron/neteaseApi.cjs", updatedAt: AT },
                login: { ...login, network: interfacesOf(names.map((name, index) => ({ name, ipv4: true, globalIpv6: index % 2 === 0 }))) },
            }, { hasLoginCookie: false, hasAnonymousCookie: false }).map(line => line.text);
            expect(lines).toContain('app: 1.2.3 electron 38.0.0 linux arm64 (6.8.0-45-generic)');
            expect(lines).toContain("local api: error loopback-v4:- error=\"Cannot find module '@neteasecloudmusicapienhanced/api' / Require stack: / - <path>\"");
            // Ten interfaces, each with what it carries; the one named after its owner without its name.
            expect(lines).toContain(`network: global IPv6 addresses=5; interfaces: ${[...names.slice(0, 9), '<device>'].map((name, index) => `${name}[${index % 2 === 0 ? 'v4,v6' : 'v4'}]`).join(', ')}`);
            expect(lines.every(line => !line.includes('\n'))).toBe(true);
        });

        // One rule for an interface's name: printed when every word of it is one that systems give
        // interfaces, a single letter or a number; any other name is somebody's and prints <device>.
        it('prints an interface\'s name only when it is a system\'s own, and <device> for every other', () => {
            const printedInterfaces = (names: string[]): string => formatNeteaseLoginDiagnostics({
                ...snapshot,
                login: { ...login, network: interfacesOf(names.map(name => ({ name, ipv4: true, globalIpv6: false }))) },
            }, { hasLoginCookie: false, hasAnonymousCookie: false }).map(line => line.text).find(line => line.startsWith('network:'))!.split('interfaces: ')[1];
            const systems = [
                'Wi-Fi', 'Ethernet 2', 'Ethernet0', 'en0', 'lo', 'utun4', 'bridge100', 'enp0s31f6', 'wlp0s20f3', 'tailscale0', 'OpenVPN TAP-Windows6',
                'Local Area Connection* 10', '本地连接* 10', 'Bluetooth Network Connection 2', 'vEthernet (WSL (Hyper-V firewall))', 'VMware Network Adapter VMnet8',
                // The fifth check: names systems and proxy tools give that printed <device>.
                'wlo1', 'wwp0s20f0u2i12', 'ens3f0np0', 'lxcbr0', 'cni0', 'flannel.1', 'podman0', 'ib0', 'vxlan0', 'pktap0', 'XHC20', 'fw0', 'Npcap Loopback Adapter', 'Radmin VPN',
                'vEthernet (External Switch)', 'WireGuard Tunnel', 'Teredo Tunneling Pseudo-Interface', 'OpenVPN Wintun', 'Meta', 'Mihomo', 'Clash',
            ];
            expect(printedInterfaces(systems)).toBe(systems.map(name => `${name}[v4]`).join(', '));
            const somebodys = [
                "Zhang San's iPhone", 'Zhang San’s iPhone', '李华的 iPhone', "James' iPad", 'iPhone de Juan', 'Annas iPhone', 'iPhone von Anna', 'Zhang San Hotspot',
                '张三 iPhone', 'LiHua-PC', 'zhangsan-hotspot', 'AndroidAP_zhangsan', 'USB Ethernet (Zhang San)', '我的热点', 'enx0011aabbccdd', '',
                // The fifth check: a name made only of words on the list, or of a lone letter, beside a person's device; and a name with an apostrophe.
                "Nat's iPhone", "Pan's iPad", 'Lan iPhone', "Lo's Hotspot", "Em's iPhone", 'Bond Hotspot', "J's iPhone", "K's Wi-Fi", 'L H iPhone', 'Pan1988 Hotspot',
                'pan_hotspot', 'Mobile Hotspot Pan', 'ZeroTier One [8056c2e21c000001]',
            ];
            expect(printedInterfaces(somebodys)).toBe(somebodys.map(() => '<device>[v4]').join(', '));
        });

        // A careless adapter, or a mod's: none of these is done by the six platforms.
        it('cannot be made to print what was not cleaned: not by changing a built line, not by calling the builder as a function', () => {
            const line = diagnosticLine`ok ${1}`;
            expect(() => { (line as { text: string }).text = PRIVATE.path; }).toThrow();
            // A copy of a built line is not a built line.
            const forged = { ...line, text: PRIVATE.token };
            const called = (diagnosticLine as unknown as (...parts: unknown[]) => LoginDiagnosticLine)([`said ${PRIVATE.path} `, ' end'], PRIVATE.token);
            expect(called.text).toBe("said EPERM: operation not permitted, open '<path>' refused MUSIC_U=<value> for uin <number> end");
            const report = reportOf([line, forged, called]);
            expect(report).not.toMatch(LEFT_OF_PRIVATE);
            expect(report.split('\n').slice(-4, -1)).toEqual(['  ok 1', '  [object Object]', `  ${called.text}`]);
        });

        it('is written whatever a platform hands in for its lines', async () => {
            // A line that cannot be turned into a string; something that is not a list at all.
            expect(reportOf([Object.create(null), Symbol('x'), [PRIVATE.token]]).split('\n').slice(-4, -1)).toEqual(['  [object Object]', '  Symbol(x)', '  refused MUSIC_U=<value> for uin <number>']);
            for (const notAList of [PRIVATE.path, null, undefined, 42]) expect(reportOf(notAList as never).split('\n').slice(-2, -1)).toEqual(['  (none)']);
            // A platform that fails while it collects them, with something that is no error.
            const netease = listOnlineMusicProviders().find(provider => provider.id === 'netease')!;
            const collect = vi.spyOn(netease.auth!, 'getLoginDiagnostics');
            for (const thrown of [Object.create(null), PRIVATE.path, { toString: () => PRIVATE.token }]) {
                collect.mockRejectedValue(thrown);
                const report = reportOf(await omni.getLoginDiagnostics('netease'));
                expect(report).toContain('  provider diagnostics unavailable: ');
                expect(report).not.toMatch(LEFT_OF_PRIVATE);
            }
            collect.mockRestore();
            await expect(omni.getLoginDiagnostics('a-platform-that-is-gone')).resolves.toHaveLength(1);
        });

        it('cleans whole a line that the builder did not make, whatever hands it in', () => {
            const forged = { text: PRIVATE.path };
            const report = reportOf([PRIVATE.token, forged, 42, null, diagnosticLine`kept: status=${200}`]);
            expect(report).not.toMatch(LEFT_OF_PRIVATE);
            expect(report.split('\n').slice(-6, -1)).toEqual(['  refused MUSIC_U=<value> for uin <number>', '  [object Object]', '  42', '  null', '  kept: status=200']);
        });

        it('cleans the sentence of an error a platform throws while it collects its lines', async () => {
            const netease = listOnlineMusicProviders().find(provider => provider.id === 'netease')!;
            const collect = vi.spyOn(netease.auth!, 'getLoginDiagnostics').mockRejectedValue(new Error(PRIVATE.path));
            const report = reportOf(await omni.getLoginDiagnostics('netease'));
            collect.mockRestore();
            expect(report).toContain("  provider diagnostics unavailable: EPERM: operation not permitted, open '<path>'");
            expect(report).not.toMatch(LEFT_OF_PRIVATE);
        });
    });

    it('wraps the report in a code block ready to paste into an issue', () => {
        const report = formatLoginDiagnosticReport({
            generatedAt: AT,
            appVersion: '1.2.3',
            userAgent: 'test-agent',
            providerId: 'netease',
            methodId: null,
            failure: 'check-error',
            timeline: [{ at: AT, event: 'state', detail: { state: 'error', message: 'code 404: Not Found', elapsedMs: 2000 } }],
            providerLines: [diagnosticLine`runtime: electron (local API)`],
        });

        expect(report.split('\n')).toEqual([
            '### Folia QR login diagnostics',
            '',
            '```text',
            'generated: 2026-09-26T12:00:00.000Z',
            'app: 1.2.3',
            'user agent: test-agent',
            'provider: netease',
            'failure: check-error',
            'QR session timeline (1, UTC):',
            '  12:00:00.000 state state=error message="code 404: Not Found" elapsedMs=2000',
            'self-check: not run',
            'netease details:',
            '  runtime: electron (local API)',
            '```',
        ]);
    });

    // The case the window shows and its facts stand in the report, after the old `failure` line.
    // What a fact may hold is decided where the facts are made (loginFailureCase.test.ts): the
    // platform's words are cleaned there, and the sentence of a thrown error never becomes a fact.
    it('says which build produced the report and, on the web, which site it ran on', () => {
        const report = formatLoginDiagnosticReport({
            generatedAt: AT,
            appVersion: '1.2.3',
            userAgent: 'test-agent',
            build: 'unofficial (someone/folia-fork@abc1234)',
            origin: 'https://folia.example.com',
            providerId: 'netease',
            methodId: null,
            failure: 'start-error',
            timeline: [],
            providerLines: [],
        });

        expect(report.split('\n').slice(4, 7)).toEqual([
            'app: 1.2.3',
            'build: unofficial (someone/folia-fork@abc1234)',
            'origin: https://folia.example.com',
        ]);
        expect(report).toContain('self-check: not run');
    });

    it('writes the self-check verdict first, then every layer it checked, with what came from outside cleaned', () => {
        const result: LoginSelfCheckResult = {
            providerId: 'netease',
            runtime: 'electron',
            startedAt: AT,
            durationMs: 1556,
            backend: { status: 'running', port: 52001, error: null, probe: { ok: true, httpStatus: 200, durationMs: 6, error: null } },
            proxy: { env: { HTTPS_PROXY: 'http://zhang:secret@10.0.0.2:8080' }, system: 'DIRECT' },
            hosts: [{
                host: 'interfacepc.music.163.com',
                dns: { addresses: [{ address: '198.18.6.189', family: 4 }], durationMs: 10, error: null, fakeIp: true },
                connections: [{ address: '198.18.6.189', family: 4, tcpMs: 9, tlsMs: 906, error: null, protocol: 'TLSv1.3' }],
                https: { httpStatus: 200, durationMs: 1543, remote: { address: '198.18.6.189', family: 4 }, error: null, clockSkewMs: -57627 },
            }],
            credentialStore: { encryptionAvailable: true, backend: null },
        };

        const lines = formatLoginSelfCheck({ status: 'done', result, verdict: { kind: 'network-ok', detail: null, proxy: 'fake-ip' } });
        expect(lines.slice(0, 4)).toEqual([
            'self-check: electron, 1556ms',
            '  verdict: network-ok; proxy: fake-ip',
            '  backend: running 127.0.0.1:52001; GET / → HTTP 200 in 6ms',
            '  credential store: encryption=yes',
        ]);
        // The proxy setting is the user's: it is cleaned. What the check measured itself stays.
        expect(lines[4]).toMatch(/^ {2}proxy: env HTTPS_PROXY=.*; system DIRECT$/);
        expect(lines[4]).not.toMatch(/zhang|secret|10\.0\.0\.2/);
        expect(lines.slice(5)).toEqual([
            '  interfacepc.music.163.com',
            '    dns: 10ms → 198.18.6.189 (v4) [fake-ip]',
            '    v4 198.18.6.189: tcp 9ms, tls 906ms TLSv1.3',
            '    https: HTTP 200 in 1543ms via 198.18.6.189 (v4), clock skew -57.6s',
        ]);
        expect(formatLoginSelfCheck({ status: 'running' })).toEqual(['self-check: still running when the report was generated']);
        expect(formatLoginSelfCheck({ status: 'failed', message: 'IPC channel closed' })).toEqual(['self-check: failed (IPC channel closed)']);
        expect(formatLoginSelfCheck({ status: 'failed', message: PRIVATE.path }).join('\n')).not.toMatch(LEFT_OF_PRIVATE);
    });

    it('adds the case and its facts when the sign-in failed, and nothing when it did not', () => {
        const facts = loginFailureFacts({ step: 'check', inBrowser: false, scanned: true }, {
            detail: { case: 'retry-later', code: '800', message: 'uin 2873651094 is slowed down', upstreamCode: '50006', retryAfterMs: 31000, httpStatus: 200 },
            error: new Error("request to localhost:3300 failed, open 'C:\\Users\\Zhang San\\x.json'"),
        });
        const report = formatLoginDiagnosticReport({
            generatedAt: AT, appVersion: '1.2.3', userAgent: 'test-agent', providerId: 'qq', methodId: 'wechat', failure: 'check-error',
            loginFailure: { case: loginCaseOf(facts), facts, at: AT + 2000 },
            timeline: [], providerLines: [],
        }).split('\n');
        expect(report.slice(6, 10)).toEqual([
            'provider: qq (method wechat)',
            'failure: check-error',
            'case: retry-later (kind C) at 12:00:02.000',
            'facts: step=check inBrowser=false scanned=true code=800 message="uin <number> is slowed down" httpStatus=200 upstreamCode=50006 retryAfterMs=31000',
        ]);
        expect(report.join('\n')).not.toMatch(/localhost|Zhang|2873651094/);

        const fine = formatLoginDiagnosticReport({
            generatedAt: AT, appVersion: null, userAgent: '', providerId: 'qq', methodId: null, failure: null, loginFailure: null, timeline: [], providerLines: [],
        });
        expect(fine).not.toMatch(/^case:|^facts:/m);
    });

    it('puts a short report into the issue link and falls back to a paste hint when it is too long', () => {
        const short = new URL(buildLoginIssueUrl({ providerId: 'netease', report: 'short report', pasteHint: 'paste here' }));
        expect(short.searchParams.get('title')).toBe('[QR login] netease login failed');
        expect(short.searchParams.get('body')).toBe('short report');

        const long = new URL(buildLoginIssueUrl({ providerId: 'netease', report: 'x'.repeat(10_000), pasteHint: 'paste here' }));
        expect(long.searchParams.get('body')).toBe('paste here');

        const empty = new URL(buildLoginIssueUrl({ providerId: 'netease', report: '', pasteHint: 'paste here' }));
        expect(empty.searchParams.get('body')).toBe('paste here');
    });
});

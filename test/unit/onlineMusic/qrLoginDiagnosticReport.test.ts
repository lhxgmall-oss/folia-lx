import { describe, expect, it } from 'vitest';
import { buildQrLoginIssueUrl, formatQrLoginDiagnosticReport } from '@/utils/qrLoginDiagnosticReport';
import { formatNeteaseLoginDiagnostics } from '@/services/onlineMusic/neteaseLoginDiagnostics';

// test/unit/onlineMusic/qrLoginDiagnosticReport.test.ts

const AT = Date.UTC(2026, 8, 26, 12, 0, 0);

const snapshot: ElectronNeteaseLoginDiagnostics = {
    app: { version: '1.2.3', electron: '38.0.0', platform: 'win32', arch: 'x64', osRelease: '10.0.22631' },
    apiStatus: { status: 'running', port: 52001, error: null },
    capturedAt: AT,
    startup: {
        anonymousTokenAtLoad: 'present',
        anonymousTokenRefreshed: true,
        xeapiKeySource: 'network',
        xeapiKeyVersion: '3',
        listenHost: '127.0.0.1',
        listenPort: 52001,
    },
    network: { interfaces: [{ name: 'Wi-Fi', ipv4: true, globalIpv6: true }], globalIpv6Count: 2 },
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
    }],
};

describe('QR login diagnostic report', () => {
    it('lays out the main-process record so the swallowed NetEase code is visible', () => {
        const lines = formatNeteaseLoginDiagnostics(snapshot, { hasLoginCookie: false, hasAnonymousCookie: true });

        expect(lines).toContain('runtime: electron (local API)');
        expect(lines).toContain('local api: running 127.0.0.1:52001');
        expect(lines).toContain('network: global IPv6 addresses=2; interfaces: Wi-Fi[v4,v6]');
        expect(lines).toContain(
            '  12:00:00.000 /api/login/qrcode/client/login rejected status=400 code=8821 msg="需要行为验证码验证" 140ms ip-header=none device=…ABCDEF MUSIC_U=no MUSIC_A=yes',
        );
    });

    it('reports when the process started and how often the login identity was rotated', () => {
        const at = (minutes: number) => AT + minutes * 60_000;
        // 重置 3 次：两次已在之后的要码前轮换，最后一次还在等下一次要码。
        expect(formatNeteaseLoginDiagnostics(
            {
                ...snapshot,
                identity: {
                    processStartedAt: at(-30), connectionResets: 3, rotations: 2,
                    lastRotatedAt: at(5), lastTokenRenewed: false, pendingRotation: true,
                },
            },
            { hasLoginCookie: false, hasAnonymousCookie: true },
        )).toContain('identity: process started 2026-09-26T11:30:00.000Z, qr connection resets=3, device rotations=2 (last 12:05:00.000, new anonymous token=no), rotation pending=yes');
        expect(formatNeteaseLoginDiagnostics(
            {
                ...snapshot,
                identity: {
                    processStartedAt: AT, connectionResets: 0, rotations: 0,
                    lastRotatedAt: null, lastTokenRenewed: null, pendingRotation: false,
                },
            },
            { hasLoginCookie: false, hasAnonymousCookie: true },
        )).toContain('identity: process started 2026-09-26T12:00:00.000Z, qr connection resets=0, device rotations=0, rotation pending=no');
    });

    it('says plainly when there is no main process to ask', () => {
        expect(formatNeteaseLoginDiagnostics(null, { hasLoginCookie: false, hasAnonymousCookie: false })[0])
            .toBe('runtime: web (remote API, no main-process record)');
    });

    it('wraps the report in a code block ready to paste into an issue', () => {
        const report = formatQrLoginDiagnosticReport({
            generatedAt: AT,
            appVersion: '1.2.3',
            userAgent: 'test-agent',
            providerId: 'netease',
            methodId: null,
            failure: 'check-error',
            timeline: [{ at: AT, event: 'state', detail: { state: 'error', message: 'code 404: Not Found', elapsedMs: 2000 } }],
            providerLines: ['runtime: electron (local API)'],
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
            'netease details:',
            '  runtime: electron (local API)',
            '```',
        ]);
    });

    it('puts a short report into the issue link and falls back to a paste hint when it is too long', () => {
        const short = new URL(buildQrLoginIssueUrl({ providerId: 'netease', report: 'short report', pasteHint: 'paste here' }));
        expect(short.searchParams.get('title')).toBe('[QR login] netease login failed');
        expect(short.searchParams.get('body')).toBe('short report');

        const long = new URL(buildQrLoginIssueUrl({ providerId: 'netease', report: 'x'.repeat(10_000), pasteHint: 'paste here' }));
        expect(long.searchParams.get('body')).toBe('paste here');

        const empty = new URL(buildQrLoginIssueUrl({ providerId: 'netease', report: '', pasteHint: 'paste here' }));
        expect(empty.searchParams.get('body')).toBe('paste here');
    });
});

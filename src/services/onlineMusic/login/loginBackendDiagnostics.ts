import type { LoginDiagnosticLine } from '../../../types/onlineMusic';
import { diagnosticLine, formatDiagnosticClock } from './loginDiagnosticReport';

// src/services/onlineMusic/login/loginBackendDiagnostics.ts
// 诊断报告里内嵌后端快照（electron/loginBackendIpc.cjs 的 get-login-diagnostics）几个平台共用的几段：
// 应用环境与凭据保存、拉起后端的每一步、一次出站连接（electron/networkRecorder.cjs 记下的）。平台自己的部分
// 在各自的文件夹里排。地址不进报告：连上的是 v4 还是 v6、换过几次地址就够分辨；域名只印平台认得的。

const MAX_RECENT_CONNECTIONS = 20;

/** 平台认得的上游域名：认得的印出来，别的（代理、别人的服务器）印 <host>。 */
export type KnownHost = (host: string) => boolean;

const yesNo = (value: boolean | null | undefined): string => (value == null ? 'unknown' : value ? 'yes' : 'no');
const ms = (value: number | null | undefined): LoginDiagnosticLine => (value == null ? diagnosticLine`-` : diagnosticLine`${value}ms`);

// 几段洗过的行接成一段。分隔符写在模板里：当成一个值交进去会被洗掉两头的空白。
const joined = (parts: LoginDiagnosticLine[], separator: ' ' | ', ' | ''): LoginDiagnosticLine | null => parts
    .reduce<LoginDiagnosticLine | null>((all, part) => {
        if (!all) return part;
        if (separator === ' ') return diagnosticLine`${all} ${part}`;
        return separator === ', ' ? diagnosticLine`${all}, ${part}` : diagnosticLine`${all}${part}`;
    }, null);

// 认得的域名和它后面的路径按点和斜线拆开逐段洗：整串交给洗文字的规则，会被当成一个地址或一条文件路径换掉。
const inPieces = (text: string): LoginDiagnosticLine => (
    joined(text.split(/([./])/).filter(Boolean).map(piece => diagnosticLine`${piece}`), '') ?? diagnosticLine``
);

const formatValue = (value: unknown): string => {
    if (typeof value === 'string') return /\s/.test(value) || value === '' ? JSON.stringify(value) : value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

/** 一串字段排成 key=value；每一对整个交给洗文字的规则：带着字段名，它才认得出 uin=… 这样的账号。 */
export const formatFields = (fields: Record<string, unknown> | null | undefined): LoginDiagnosticLine | null => joined(
    Object.entries(fields ?? {})
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => diagnosticLine`${`${key}=${formatValue(value)}`}`),
    ' ',
);

/** 应用与系统、凭据保存（safeStorage）各一行；快照里没有这一段时只一行 unknown。 */
export const formatBackendApp = (app: ElectronAppEnvironment | null | undefined): LoginDiagnosticLine[] => {
    if (!app) return [diagnosticLine`app: unknown`];
    const store = app.credentialStore;
    return [
        diagnosticLine`app: ${app.version} electron ${app.electron} ${app.platform} ${app.arch} (${app.osRelease})`,
        diagnosticLine`os: ${app.osVersion}, locale ${app.locale}, time zone ${app.timeZone}, uptime ${app.uptimeSec}s`,
        store?.error
            ? diagnosticLine`credential store: error "${store.error}"`
            : diagnosticLine`credential store: encryption=${yesNo(store?.encryptionAvailable)}${store?.backend ? diagnosticLine` backend=${store.backend}` : ''}`,
    ];
};

/** 每一轮拉起后端：结局与耗时，下面是每一步的结局、耗时、细节和错误原文；快照里没有这一段时只一行 unknown。 */
export const formatBackendStartup = (runs: ElectronBackendStartupRun[] | null | undefined): LoginDiagnosticLine[] => {
    if (!runs) return [diagnosticLine`startup runs: unknown`];
    if (runs.length === 0) return [diagnosticLine`startup runs: none`];
    return [
        diagnosticLine`startup runs (${runs.length}, oldest first, UTC):`,
        ...runs.flatMap(run => [
            diagnosticLine`  ${formatDiagnosticClock(run.startedAt)} ${run.outcome}${run.finishedAt != null ? diagnosticLine` (${run.finishedAt - run.startedAt}ms)` : ''}`,
            ...(run.steps ?? []).map((step) => {
                const detail = formatFields(step.detail);
                return diagnosticLine`    ${step.id} ${step.outcome} ${ms(step.durationMs)}${detail ? diagnosticLine` ${detail}` : ''}${step.error ? diagnosticLine` error="${step.error}"` : ''}`;
            }),
        ]),
    ];
};

/**
 * 一次连接一行：去向 → 连上的地址族、TCP / TLS 耗时 → 结局（总耗时）；Happy Eyeballs 换过地址时附上每次尝试。
 * withPath 为 false 时只印域名（登录请求下面的那几行，接口已经在请求那一行）。
 */
export const formatConnection = (connection: ElectronNetworkConnection, knownHost: KnownHost, withPath = true): LoginDiagnosticLine => {
    const known = knownHost(connection.host);
    // 查询串不进报告：拆成小段逐段洗时，值里点号后面那半截已经离开了它的字段名。排查只看接口就够。
    const [route, query] = (connection.path ?? '').split(/\?(.*)/s);
    const target = known
        ? diagnosticLine`${inPieces(withPath ? `${connection.host}${route}` : connection.host)}${withPath && query !== undefined ? diagnosticLine`?<query>` : ''}`
        : diagnosticLine`<host>`;
    const timing = joined([
        diagnosticLine`tcp=${ms(connection.connectMs)}`,
        ...(connection.tlsMs != null ? [diagnosticLine`tls=${ms(connection.tlsMs)}`] : []),
        ...(connection.reusedSocket ? [diagnosticLine`reused-socket`] : []),
    ], ' ');
    const { error, dnsError } = connection;
    const outcome = error
        ? diagnosticLine`${error.code ?? 'error'} at ${error.phase}: ${error.message}`
        : dnsError
            ? diagnosticLine`DNS ${dnsError.code ?? 'error'}: ${dnsError.message}`
            : connection.status != null ? diagnosticLine`HTTP ${connection.status}` : diagnosticLine`${connection.settled ?? 'pending'}`;
    const remote = connection.remote?.address ? diagnosticLine`v${connection.remote.family ?? '?'}` : diagnosticLine`no connection`;
    const attempts = (connection.attempts ?? []).length > 1
        ? diagnosticLine`; attempts: ${joined(connection.attempts.map(attempt => diagnosticLine`v${attempt.family ?? '?'} ${attempt.outcome}${attempt.error?.code ? diagnosticLine` ${attempt.error.code}` : ''}`), ', ')}`
        : '';
    return diagnosticLine`${connection.method ? diagnosticLine`${connection.method} ` : ''}${target} → ${remote} ${timing} → ${outcome} (${ms(connection.totalMs)})${attempts}`;
};

/** 最近的连接，最多 20 条，每条带时刻。 */
export const formatRecentConnections = (label: string, connections: ElectronNetworkConnection[], knownHost: KnownHost): LoginDiagnosticLine[] => {
    const all = connections ?? [];
    const recent = all.slice(-MAX_RECENT_CONNECTIONS);
    const total = all.length > recent.length ? diagnosticLine` of ${all.length}` : '';
    return [
        diagnosticLine`${label} (${recent.length}${total}, oldest first, UTC):`,
        ...(recent.length > 0
            ? recent.map(connection => diagnosticLine`  ${connection.at != null ? diagnosticLine`${formatDiagnosticClock(connection.at)} ` : ''}${formatConnection(connection, knownHost)}`)
            : [diagnosticLine`  (none)`]),
    ];
};

/** 去主进程取快照；取不到时那句错误成为报告的一行（诊断自己不能再失败）。 */
export const readBackendSnapshot = async (
    providerId: ElectronLoginDiagnostics['providerId'],
): Promise<{ snapshot: ElectronLoginDiagnostics | null; failure: LoginDiagnosticLine | null }> => {
    const getSnapshot = typeof window === 'undefined' ? undefined : window.electron?.getLoginDiagnostics;
    if (!getSnapshot) return { snapshot: null, failure: null };
    try {
        return { snapshot: await getSnapshot(providerId), failure: null };
    } catch (error) {
        return { snapshot: null, failure: diagnosticLine`backend diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}` };
    }
};

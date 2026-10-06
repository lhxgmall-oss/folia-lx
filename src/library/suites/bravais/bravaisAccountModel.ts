import type { TFunction } from 'i18next';
import type { OnlineProviderId, ProviderAccountSummary } from '../../../types/onlineMusic';
import type {
    LibraryAccountLogoutState,
    LibraryLoginPhase,
    LibraryProviderSwitchReason,
} from '../../core/contracts/account';
import type { LibraryLoginView, LibraryProviderSwitchView } from '../../core/bindings/useLibraryAccount';
import { canLogoutProvider, isAwaitingLoginMethod, resolveProviderSelectLabel } from '../../core/model/accountRules';
import { canSwitchToProviderDirectly } from '../../core/model/onlineProviderAccountView';
import { translateHomeMessage } from '../../core/model/homeSources';

// src/library/suites/bravais/bravaisAccountModel.ts
// B10 账户（设计稿 §10.7）的纯投影：
// - 缝里的表单态：登录态（二维码 / 选登录方式 / 后端故障、状态行、重试 / 重启 / 关闭、诊断提示）与确认态（切换 / 取消），
//   由 account surface 从账户 controller 的已翻译视图投影出来，交给 stage 画；
// - 首页在线页签窄缝里的平台切换（account-select / account-logout）的行：当前标记、账户状态、选它会做什么、能不能登出。
// 这里只有数据（已翻译的文案与判定），回调另给；规则都来自 core/model/accountRules，与 grid 的弹窗 / 切换器一致。

// ─── 表单态：登录 ──────────────────────────────────────────────────────

/** 二维码位上画什么：二维码、还在要码、选方式的占位（不要码）、后端故障的原因（取代二维码）。 */
export type BravaisLoginQr =
    | { kind: 'image'; url: string }
    | { kind: 'loading' }
    | { kind: 'choose-method'; text: string }
    | { kind: 'backend-failure'; title: string; detail: string | null };

export type BravaisLoginMethodOption = { id: string; label: string; iconKey: string; selected: boolean };

export type BravaisLoginForm = {
    kind: 'login';
    providerId: OnlineProviderId;
    /** 会话代次：诊断复制的反馈只属于这一轮。 */
    sessionId: number;
    phase: LibraryLoginPhase;
    title: string;
    note: string;
    /** 状态行；选方式的第一步与后端故障时为 null。 */
    status: string | null;
    tone: 'normal' | 'success' | 'error';
    qr: BravaisLoginQr;
    /** provider 声明了多种方式（QQ 两步式）；current 是已选方式的说明，还没选时为 null。 */
    methods: { title: string; hint: string; current: string | null; options: readonly BravaisLoginMethodOption[] } | null;
    /**
     * 重试：过期 / 失败、不在选方式的第一步、后端没有故障时出现；后端要求冷却时按钮在但禁用，并显示秒数
     * （retryCooldownSeconds，按失败那一刻算，与状态行一致；冷却结束时快照清掉它，按钮随之可用）。
     */
    retry: { label: string; disabled: boolean; cooldownSeconds: number | null } | null;
    /** 网易本地后端故障时的重启（account-backend-restart 声明了才有）；重启中禁用。 */
    restart: { label: string; restarting: boolean } | null;
    /** 失败后的诊断提示（account-login-diagnostics 声明了、且视图给了 diagnosticsPrompt 才有）。 */
    diagnosticsPrompt: string | null;
    closeLabel: string;
};

export type BravaisLoginFeatures = {
    diagnostics: boolean;
    backendRestart: boolean;
};

/** 状态行的语气：扫码确认是成功；失败（error，或扫过码之后过期）是错误。 */
const resolveLoginTone = (view: LibraryLoginView): BravaisLoginForm['tone'] => {
    const { phase, failure } = view.session;
    if (phase === 'confirmed') return 'success';
    if (phase === 'error' || (phase === 'expired' && failure)) return 'error';
    return 'normal';
};

/** 一份已翻译的登录视图 → 缝里的登录态（与 grid 登录弹窗同一套显示条件）。 */
export const projectBravaisLoginForm = (view: LibraryLoginView, features: BravaisLoginFeatures): BravaisLoginForm => {
    const { session, methodStep, backendFailure } = view;
    const awaitingMethod = isAwaitingLoginMethod(session);
    const qr: BravaisLoginQr = backendFailure
        ? { kind: 'backend-failure', title: backendFailure.title, detail: session.backend.detail }
        : awaitingMethod && methodStep
            ? { kind: 'choose-method', text: methodStep.pending }
            : session.qrImageUrl
                ? { kind: 'image', url: session.qrImageUrl }
                : { kind: 'loading' };
    const canOfferRetry = (session.phase === 'expired' || session.phase === 'error') && !awaitingMethod && !backendFailure;
    return {
        kind: 'login',
        providerId: session.providerId,
        sessionId: session.id,
        phase: session.phase,
        title: view.title,
        note: view.note,
        status: view.status,
        tone: resolveLoginTone(view),
        qr,
        methods: methodStep
            ? {
                title: methodStep.title,
                hint: methodStep.hint,
                current: awaitingMethod ? null : methodStep.current,
                options: methodStep.options.map(option => ({
                    id: option.id,
                    label: option.label,
                    iconKey: option.iconKey,
                    selected: option.id === session.selectedMethodId,
                })),
            }
            : null,
        retry: canOfferRetry
            ? {
                label: view.retryLabel,
                disabled: session.retryCooldownSeconds !== null,
                cooldownSeconds: session.retryCooldownSeconds,
            }
            : null,
        restart: features.backendRestart && backendFailure
            ? {
                label: session.backend.restarting ? backendFailure.restartingLabel : backendFailure.restartLabel,
                restarting: session.backend.restarting,
            }
            : null,
        diagnosticsPrompt: features.diagnostics ? view.diagnosticsPrompt : null,
        closeLabel: view.closeLabel,
    };
};

// ─── 表单态：确认 ──────────────────────────────────────────────────────

export type BravaisConfirmForm = {
    kind: 'confirm';
    /** 确认 / 取消按它结算（过期的返回 stale）。 */
    requestId: number;
    providerId: OnlineProviderId;
    reason: LibraryProviderSwitchReason;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
};

export const projectBravaisConfirmForm = (
    view: LibraryProviderSwitchView,
    labels: { confirm: string; cancel: string },
): BravaisConfirmForm => ({
    kind: 'confirm',
    requestId: view.request.id,
    providerId: view.request.to,
    reason: view.request.reason,
    title: view.title,
    description: view.description,
    confirmLabel: labels.confirm,
    cancelLabel: labels.cancel,
});

export type BravaisAccountForm = BravaisLoginForm | BravaisConfirmForm;

/**
 * 缝此刻该显示哪一个表单：待确认的切换优先（它可能紧跟在登录之后——扫码确认后问要不要切过去，也可能在登录界面
 * 开着时到来），其次是此刻该显示的登录（方式还在解析、扫码已确认时不显示）；都没有就是 null。
 */
export const resolveBravaisAccountForm = ({
    login,
    pendingSwitch,
    features,
    confirmLabels,
}: {
    login: LibraryLoginView | null;
    pendingSwitch: LibraryProviderSwitchView | null;
    features: BravaisLoginFeatures;
    confirmLabels: { confirm: string; cancel: string };
}): BravaisAccountForm | null => {
    if (pendingSwitch) return projectBravaisConfirmForm(pendingSwitch, confirmLabels);
    if (login?.visible) return projectBravaisLoginForm(login, features);
    return null;
};

// ─── 首页窄缝的平台切换 ────────────────────────────────────────────────

export type BravaisAccountRow = {
    providerId: OnlineProviderId;
    label: string;
    /** 账户状态：昵称 / 未登录 / 无需登录 / 未配置。 */
    detail: string;
    current: boolean;
    /** 未配置的平台不能选（行禁用）。 */
    configured: boolean;
    /** 选它直接切换（已登录或无账户），否则要先登录。 */
    direct: boolean;
    /** 选它会做什么（「切换到 X」/「登录 X」）；当前平台与未配置的为空串。 */
    actionLabel: string;
    /**
     * 登出（规则同 grid 切换器：只有当前且已登录的平台有，canLogoutProvider）；已有登出在途时禁用，在途的那一行
     * 文案换成「正在登出」。
     */
    logout: { label: string; disabled: boolean } | null;
};

/** 切换器里的一行能不能现在登出：有登出入口，且没有登出在途（logout.status 不是 pending）。 */
export const canRunLogout = (row: Pick<BravaisAccountRow, 'logout'>): boolean => Boolean(row.logout && !row.logout.disabled);

const describeProviderStatus = (provider: ProviderAccountSummary, t: TFunction): string => {
    if (!provider.availability.configured) return t('libraryBravaisAccount.notConfigured');
    if (provider.requiresAccount === false) return t('home.providerNoAccount');
    return provider.user?.nickname || t('libraryBravaisAccount.notSignedIn');
};

/**
 * provider 列表 → 切换器的行。与 grid 的切换器一样不列运行时不可用的 provider（availability.reason 为
 * runtime-unavailable，例如本构建不带的后端）。
 */
export const projectAccountSwitcherRows = ({
    providers,
    activeProviderId,
    logout,
    t,
}: {
    providers: readonly ProviderAccountSummary[];
    activeProviderId: OnlineProviderId;
    logout: LibraryAccountLogoutState;
    t: TFunction;
}): BravaisAccountRow[] => {
    const logoutPending = logout.status === 'pending';
    return providers
        .filter(provider => provider.availability.reason !== 'runtime-unavailable')
        .map(provider => {
            const current = provider.providerId === activeProviderId;
            const configured = provider.availability.configured;
            const loggingOut = logoutPending && logout.providerId === provider.providerId;
            return {
                providerId: provider.providerId,
                label: provider.shortName || provider.displayName,
                detail: describeProviderStatus(provider, t),
                current,
                configured,
                direct: canSwitchToProviderDirectly(provider),
                actionLabel: current || !configured ? '' : translateHomeMessage(t, resolveProviderSelectLabel(provider)),
                logout: canLogoutProvider(provider, activeProviderId)
                    ? {
                        label: loggingOut ? t('libraryBravaisAccount.loggingOut') : t('account.logout'),
                        disabled: logoutPending,
                    }
                    : null,
            };
        });
};

import React, { useCallback, useEffect, useState } from 'react';
import { FileUp, Link2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    activateLxScript, importLxScriptFile, importLxScriptUrl, readLxState, removeLxScript, updateLxSettings,
    type LxQualitySetting, type LxState, type LxSubSourceSetting,
} from '../../../../../../services/onlineMusic/lx/lxScripts';
import { errorMessage } from '../../../../../../utils/errorText';
import { Button, Row, Select, Status, TextField, Toggle } from '../../../kit';
import { O } from '../options';

// src/components/modal/settings/pages/integration/lx/LxSourceRows.tsx
// The LX Music rows of the 连接与集成 page (desktop only): the custom source scripts the listener
// imported (from a file or a URL; Folia-LX ships none), which one is in use and whether it loaded,
// and the LX settings: which sub-source search uses, the quality asked of the script, and whether a
// failed song is looked for on another sub-source.

const SUB_SOURCES: readonly LxSubSourceSetting[] = ['all', 'kw', 'kg', 'tx', 'wy', 'mg'];
const QUALITIES: readonly LxQualitySetting[] = ['follow', '128k', '320k', 'flac', 'flac24bit'];

export const LxSourceRows: React.FC = () => {
    const { t } = useTranslation();
    const [state, setState] = useState<LxState | null>(null);
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            setState(await readLxState());
        } catch (cause) {
            console.warn('[LX] settings: reading the state failed', cause);
            setError(errorMessage(cause));
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    // While a script is loading, ask again shortly so its status row settles.
    useEffect(() => {
        if (state?.status.state !== 'loading') return undefined;
        const timer = window.setTimeout(() => void refresh(), 800);
        return () => window.clearTimeout(timer);
    }, [state, refresh]);

    const run = async (action: () => Promise<unknown>) => {
        setBusy(true);
        setError(null);
        try {
            await action();
        } catch (cause) {
            console.warn('[LX] settings: action failed', cause);
            setError(errorMessage(cause));
        } finally {
            setBusy(false);
            await refresh();
        }
    };

    const status = state?.status;
    const statusLine = !state
        ? null
        : !state.activeId
            ? <Status>{t('lx.statusNone')}</Status>
            : status?.state === 'ready'
                ? <Status tone="ok">{t('lx.statusReady', { sources: Object.keys(status.sources).join(' / ') || '-' })}</Status>
                : status?.state === 'error'
                    ? <Status tone="error">{t('lx.statusError', { message: status.message })}</Status>
                    : <Status tone="warn">{t('lx.statusLoading')}</Status>;

    return (
        <>
            <Row option={O.lxScripts} hint={t('lx.scriptsDesc')} note={t('lx.scriptsNote')}>
                {statusLine}
            </Row>
            {state?.apis.map(api => (
                <Row
                    key={api.id}
                    sub
                    label={`${api.name}${api.version ? ` v${api.version}` : ''}`}
                    hint={[api.author, api.description].filter(Boolean).join(' · ') || undefined}
                >
                    {state.activeId === api.id
                        ? <Status tone="ok">{t('lx.inUse')}</Status>
                        : <Button onClick={() => void run(() => activateLxScript(api.id))} disabled={busy}>{t('lx.use')}</Button>}
                    <Button icon={Trash2} tip={t('lx.remove')} onClick={() => void run(() => removeLxScript(api.id))} disabled={busy} />
                </Row>
            ))}
            <Row sub label={t('lx.importFile')}>
                <Button icon={FileUp} onClick={() => void run(() => importLxScriptFile())} disabled={busy}>{t('lx.chooseFile')}</Button>
            </Row>
            <Row sub label={t('lx.importUrl')}>
                <TextField type="url" value={url} onChange={setUrl} placeholder="https://..." disabled={busy} />
                <Button
                    icon={Link2}
                    onClick={() => void run(async () => {
                        await importLxScriptUrl(url.trim());
                        setUrl('');
                    })}
                    disabled={busy || !/^https?:\/\//.test(url.trim())}
                >
                    {t('lx.import')}
                </Button>
            </Row>
            {error && <Row sub notice={error} />}
            {status?.updateAlert && (
                <Row sub notice={t('lx.updateAlert', { log: status.updateAlert.log })} hint={status.updateAlert.updateUrl} />
            )}
            {state && (
                <>
                    <Row option={O.lxSubSource} hint={t('lx.subSourceDesc')}>
                        <Select
                            value={state.settings.subSource}
                            options={SUB_SOURCES.map(value => ({ value, label: t(`lx.subSource.${value}`) }))}
                            onChange={subSource => void run(() => updateLxSettings({ subSource }))}
                        />
                    </Row>
                    <Row option={O.lxQuality} hint={t('lx.qualityDesc')}>
                        <Select
                            value={state.settings.quality}
                            options={QUALITIES.map(value => ({ value, label: t(`lx.quality.${value}`) }))}
                            onChange={quality => void run(() => updateLxSettings({ quality }))}
                        />
                    </Row>
                    <Row option={O.lxFallback} hint={t('lx.fallbackDesc')}>
                        <Toggle checked={state.settings.fallback} onChange={fallback => void run(() => updateLxSettings({ fallback }))} />
                    </Row>
                </>
            )}
        </>
    );
};

export default LxSourceRows;

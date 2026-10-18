import React, { useCallback, useEffect, useState } from 'react';
import { FileUp, Link2, ListMusic, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    activateLxScript, importLxScriptFile, importLxScriptUrl, readLxState, removeLxScript, updateLxSettings,
    type LxQualitySetting, type LxState, type LxSubSourceSetting,
} from '../../../../../../services/onlineMusic/lx/lxScripts';
import {
    clearLxMyListCache, importLxListFile, readLxCoverFillStatus, readLxMyLists, removeLxMyList,
    type LxCoverFillStatus, type LxListImportResult, type LxMyListInfo,
} from '../../../../../../services/onlineMusic/lx/lxMyLists';
import { omni } from '../../../../../../services/onlineMusic/omni';
import { setStatusMessage } from '../../../../../../stores/useStatusMessageStore';
import { errorMessage } from '../../../../../../utils/errorText';
import { Button, Row, Select, Status, TextField, Toggle } from '../../../kit';
import { O } from '../options';

// src/components/modal/settings/pages/integration/lx/LxSourceRows.tsx
// The LX Music rows of the 连接与集成 page (desktop only): the custom source scripts the listener
// imported (from a file or a URL; Folia-LX ships none), which one is in use and whether it loaded,
// and the LX settings: which sub-source search uses, the quality asked of the script, and whether a
// failed song is looked for on another sub-source. Then the lists imported from LX Music desktop's
// 「我的列表」 (an exported .lxmc / .json file, lx/lxMyLists.ts): the import button and one row per list.

const SUB_SOURCES: readonly LxSubSourceSetting[] = ['all', 'kw', 'kg', 'tx', 'wy', 'mg'];
const QUALITIES: readonly LxQualitySetting[] = ['follow', '128k', '320k', 'flac', 'flac24bit'];

export const LxSourceRows: React.FC = () => {
    const { t } = useTranslation();
    const [state, setState] = useState<LxState | null>(null);
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [myLists, setMyLists] = useState<LxMyListInfo[]>([]);
    const [covers, setCovers] = useState<LxCoverFillStatus | null>(null);

    const refresh = useCallback(async () => {
        try {
            setState(await readLxState());
        } catch (cause) {
            console.warn('[LX] settings: reading the state failed', cause);
            setError(errorMessage(cause));
        }
        try {
            setMyLists(await readLxMyLists());
            setCovers(await readLxCoverFillStatus());
        } catch (cause) {
            console.warn('[LX] settings: reading the imported lists failed', cause);
        }
    }, []);

    // While the covers of imported songs are being filled in the background, show how far it is;
    // when it ends, the home screen's lists are read again so the covers show there.
    useEffect(() => {
        if (!covers?.running) return undefined;
        const timer = window.setTimeout(() => {
            void readLxCoverFillStatus().then(next => {
                setCovers(next);
                if (!next.running) {
                    clearLxMyListCache();
                    rereadLibrary();
                    void readLxMyLists().then(setMyLists).catch(() => {});
                    if (next.total > 0) setStatusMessage({ type: 'info', text: t('lx.coversDone', { filled: next.filled, total: next.total }) });
                }
            }).catch(() => setCovers(null));
        }, 1500);
        return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [covers]);

    // The home screen's 歌单 tab shows the LX lists as the playlists of LX's local account: read
    // them again there after a change here.
    const rereadLibrary = () => {
        void omni.readAccount('lx', 'sync').catch(() => {});
    };

    const importLists = () => run(async () => {
        const result: LxListImportResult | null = await importLxListFile();
        if (!result) return;
        const text = result.skippedLocal > 0
            ? t('lx.myListsImportedSkipped', { lists: result.lists, songs: result.songs, local: result.skippedLocal })
            : t('lx.myListsImported', { lists: result.lists, songs: result.songs });
        const notes = [
            result.updated > 0 ? t('lx.myListsReplaced', { count: result.updated }) : null,
            result.emptyLists > 0 ? t('lx.myListsEmpty', { count: result.emptyLists }) : null,
            result.skippedOther > 0 ? t('lx.myListsSkippedOther', { count: result.skippedOther }) : null,
        ].filter(Boolean).join(' ');
        setStatusMessage({ type: result.lists > 0 ? 'success' : 'info', text, ...(notes ? { note: notes } : {}) });
        rereadLibrary();
        // The covers are filled in the background now; the row shows the progress.
        setCovers(await readLxCoverFillStatus().catch(() => null));
    });

    const removeList = (key: string) => run(async () => {
        await removeLxMyList(key);
        rereadLibrary();
    });

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
            <Row option={O.lxMyLists} hint={t('lx.myListsDesc')} note={t('lx.myListsNote')}>
                {covers?.running && covers.total > 0 && <Status tone="warn">{t('lx.coversFilling', { done: covers.done, total: covers.total })}</Status>}
                <Button icon={ListMusic} onClick={() => void importLists()} disabled={busy}>{t('lx.myListsImport')}</Button>
            </Row>
            {myLists.map(list => (
                <Row key={list.key} sub label={list.name} hint={t('lx.myListsCount', { count: list.count })}>
                    <Button icon={Trash2} tip={t('lx.remove')} onClick={() => void removeList(list.key)} disabled={busy} />
                </Row>
            ))}
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

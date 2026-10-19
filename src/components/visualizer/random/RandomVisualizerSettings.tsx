import React from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { BUILTIN_VISUALIZER_MODES } from '../../../types/visualizerModes';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { Button, Group, Row, Value, type SettingsGroupDef } from '../../modal/settings/kit';
import { getVisualizerModeLabel, VISUALIZER_REGISTRY } from '../registry';

// Edits the random pool independently of every style's saved tuning.
const GROUP: SettingsGroupDef = { id: 'random-visualizer-modes', titleKey: 'options.randomVisualizerModes' };
const builtinModes = new Set<string>(BUILTIN_VISUALIZER_MODES);

const RandomVisualizerSettings: React.FC = () => {
    const { t } = useTranslation();
    const { enabled, modes, mode, setModes } = useVisualizerSettingsStore(useShallow(state => ({
        enabled: state.randomVisualizerModePerSong,
        modes: state.randomVisualizerModes,
        mode: state.visualizerMode,
        setModes: state.handleSetRandomVisualizerModes,
    })));
    if (!enabled) return null;

    return (
        <Group
            def={GROUP}
            action={<Button disabled={modes.length === BUILTIN_VISUALIZER_MODES.length} onClick={() => setModes(BUILTIN_VISUALIZER_MODES)}>{t('options.randomVisualizerSelectAll')}</Button>}
        >
            <Row label={t('options.randomVisualizerCurrentStyle')}>
                <Value>{getVisualizerModeLabel(mode, t)}</Value>
            </Row>
            <div role="group" aria-label={t('options.randomVisualizerModes')} className="grid grid-cols-2 gap-2 p-3">
                {VISUALIZER_REGISTRY.filter(entry => builtinModes.has(entry.mode)).map(entry => {
                    const checked = modes.some(mode => mode === entry.mode);
                    const last = checked && modes.length === 1;
                    return (
                        <button
                            key={entry.mode}
                            type="button"
                            aria-pressed={checked}
                            disabled={last}
                            title={last ? t('options.randomVisualizerAtLeastOne') : undefined}
                            onClick={() => setModes(checked ? modes.filter(mode => mode !== entry.mode) : [...modes, entry.mode])}
                            className={`st-t-fast st-focus-inside flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed ${checked ? 'bg-[var(--st-fill2)] text-[color:var(--st-accent)]' : 'text-[color:var(--st-t2)] hover:bg-[var(--st-fill)]'}`}
                        >
                            <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center rounded border border-current">{checked && <Check size={12} />}</span>
                            <span className="truncate">{getVisualizerModeLabel(entry.mode, t)}</span>
                        </button>
                    );
                })}
            </div>
        </Group>
    );
};

export default RandomVisualizerSettings;

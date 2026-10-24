import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    DEFAULT_PLAYBACK_TEMPO,
    getPlaybackTempo,
    PLAYBACK_SEMITONES_MAX,
    PLAYBACK_SEMITONES_MIN,
    PLAYBACK_SPEED_MAX,
    PLAYBACK_SPEED_MIN,
    setPlaybackTempo,
    subscribePlaybackTempo,
} from '../../../services/playbackTempo';
import { Toggle } from '../../modal/settings/kit';
import PanelSlider from '../controls/PanelSlider';
import EqualizerSection from './EqualizerSection';

// src/components/panelTab/equalizer/PlaybackTempoSection.tsx
// 变速 / 升降调 in the audio effect window: speed, pitch, and whether a speed change keeps the pitch.
// Independent of the equaliser switch and its presets (services/playbackTempo.ts).

const SPEED_STEPS = Math.round((PLAYBACK_SPEED_MAX - PLAYBACK_SPEED_MIN) / 0.05);
const SEMITONE_STEPS = (PLAYBACK_SEMITONES_MAX - PLAYBACK_SEMITONES_MIN) * 2;

const formatSemitones = (value: number) => (value > 0 ? `+${value}` : String(value));

const PlaybackTempoSection: React.FC = () => {
    const { t } = useTranslation();
    const [tempo, setTempo] = useState(getPlaybackTempo);
    useEffect(() => subscribePlaybackTempo(setTempo), []);

    const speedText = `${tempo.speed.toFixed(2)}x`;
    const pitchText = formatSemitones(tempo.semitones);
    const isDefault = tempo.speed === 1 && tempo.semitones === 0;

    return (
        <EqualizerSection title={t('ui.playbackTempoTitle')} hint={t('ui.playbackTempoHint')}>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-7 gap-y-1.5 px-4 pb-3.5 pt-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[13px] leading-5">
                        <span className="truncate">{t('ui.playbackSpeed')}</span>
                        <span className="ml-auto shrink-0 font-mono text-xs text-[color:var(--st-t2)]">{speedText}</span>
                    </div>
                    <div className="mt-1 flex">
                        <PanelSlider
                            value={(tempo.speed - PLAYBACK_SPEED_MIN) / (PLAYBACK_SPEED_MAX - PLAYBACK_SPEED_MIN)}
                            label={t('ui.playbackSpeed')}
                            valueText={speedText}
                            onPreview={(place) => {
                                const speed = PLAYBACK_SPEED_MIN + Math.round(place * SPEED_STEPS) * 0.05;
                                if (Math.abs(speed - tempo.speed) > 0.001) setPlaybackTempo({ speed });
                            }}
                            onCommit={() => {}}
                        />
                    </div>
                </div>
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[13px] leading-5">
                        <span className="truncate">{t('ui.playbackPitch')}</span>
                        <span className="ml-auto shrink-0 font-mono text-xs text-[color:var(--st-t2)]">{pitchText}</span>
                    </div>
                    <div className="mt-1 flex">
                        <PanelSlider
                            value={(tempo.semitones - PLAYBACK_SEMITONES_MIN) / (PLAYBACK_SEMITONES_MAX - PLAYBACK_SEMITONES_MIN)}
                            label={t('ui.playbackPitch')}
                            valueText={pitchText}
                            onPreview={(place) => {
                                const semitones = PLAYBACK_SEMITONES_MIN + Math.round(place * SEMITONE_STEPS) / 2;
                                if (semitones !== tempo.semitones) setPlaybackTempo({ semitones });
                            }}
                            onCommit={() => {}}
                        />
                    </div>
                </div>
                <div className="flex min-w-0 items-center gap-3 py-1.5">
                    <label className="flex flex-1 cursor-pointer items-center gap-3 text-[13px] leading-5">
                        <span className="flex-1 truncate">{t('ui.playbackKeepPitch')}</span>
                        <Toggle checked={tempo.keepPitch} onChange={(keepPitch: boolean) => setPlaybackTempo({ keepPitch })} />
                    </label>
                    <button
                        type="button"
                        disabled={isDefault}
                        onClick={() => setPlaybackTempo({ speed: DEFAULT_PLAYBACK_TEMPO.speed, semitones: DEFAULT_PLAYBACK_TEMPO.semitones })}
                        className="shrink-0 rounded-md bg-[var(--st-fill2)] px-2.5 py-1 text-xs disabled:opacity-40"
                    >
                        {t('ui.playbackTempoReset')}
                    </button>
                </div>
            </div>
        </EqualizerSection>
    );
};

export default PlaybackTempoSection;

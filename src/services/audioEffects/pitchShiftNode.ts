import pitchShiftWorkletUrl from './pitchShiftWorklet.ts?worker&url';
import { getPitchShiftRatio, subscribePlaybackTempo } from '../playbackTempo';

// src/services/audioEffects/pitchShiftNode.ts
// The pitch-shift stage of the playback graph (升降调): a seam of two gain nodes that is a plain wire
// until a pitch shift is set, when the worklet (pitchShiftWorklet.ts) is loaded once and spliced in.
// The worklet module is only fetched by a listener who uses the feature.

export type PitchShiftStage = { input: GainNode; output: GainNode; dispose: () => void };

export const createPitchShiftStage = (context: AudioContext): PitchShiftStage => {
    const input = context.createGain();
    const output = context.createGain();
    input.connect(output);

    let worklet: AudioWorkletNode | null = null;
    let loading: Promise<AudioWorkletNode | null> | null = null;
    let spliced = false;
    let disposed = false;

    const loadWorklet = () => {
        loading ??= (async () => {
            try {
                await context.audioWorklet.addModule(pitchShiftWorkletUrl);
                if (disposed) return null;
                worklet = new AudioWorkletNode(context, 'folia-pitch-shift', { outputChannelCount: [2] });
                return worklet;
            } catch (error) {
                console.warn('[PitchShift] worklet could not load; pitch shift stays off', error);
                return null;
            }
        })();
        return loading;
    };

    const apply = async () => {
        const ratio = getPitchShiftRatio();
        if (ratio === 1) {
            worklet?.port.postMessage({ ratio: 1 });
            if (spliced && worklet) {
                input.disconnect();
                worklet.disconnect();
                input.connect(output);
                spliced = false;
            }
            return;
        }
        const node = worklet ?? await loadWorklet();
        if (!node || disposed) return;
        node.port.postMessage({ ratio: getPitchShiftRatio() });
        if (!spliced) {
            input.disconnect();
            input.connect(node);
            node.connect(output);
            spliced = true;
        }
    };

    const unsubscribe = subscribePlaybackTempo(() => { void apply(); });
    void apply();

    return {
        input,
        output,
        dispose: () => {
            disposed = true;
            unsubscribe();
            worklet?.disconnect();
        },
    };
};

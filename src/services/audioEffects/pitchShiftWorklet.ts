// src/services/audioEffects/pitchShiftWorklet.ts
// AudioWorklet processor for 升降调: moves the pitch of a live stereo stream without moving its tempo,
// using SoundTouch (soundtouchjs, LGPL-2.1) - WSOLA time stretch plus resampling, the same algorithm
// many players use for this. Loaded by pitchShiftNode.ts only once a pitch shift is set.
//
// SoundTouch works on blocks larger than the 128 frames a render quantum carries, so the output runs
// a cushion behind the input (about 60 ms at 44.1 kHz) and is silent until the cushion is filled.
import { SoundTouch } from 'soundtouchjs';

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
}

const CUSHION_FRAMES = 2048;

class FoliaPitchShiftProcessor extends AudioWorkletProcessor {
    private ratio = 1;
    private touch = this.createTouch();
    private primed = false;
    private interleavedIn = new Float32Array(256);
    private interleavedOut = new Float32Array(256);

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<{ ratio?: number }>) => {
            const ratio = Number(event.data?.ratio);
            if (!(ratio > 0) || ratio === this.ratio) return;
            const wasBypassed = this.ratio === 1;
            this.ratio = ratio;
            if (ratio === 1) return;
            if (wasBypassed) this.reset();
            this.touch.pitch = ratio;
        };
    }

    private createTouch() {
        const touch = new SoundTouch();
        const stretch = touch.stretch;
        stretch.setParameters(sampleRate, stretch.sequenceMs, stretch.seekWindowMs, stretch.overlapMs);
        touch.tempo = 1;
        return touch;
    }

    private reset() {
        this.touch = this.createTouch();
        this.touch.pitch = this.ratio;
        this.primed = false;
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]) {
        const input = inputs[0];
        const output = outputs[0];
        const frames = output[0]?.length ?? 128;
        const inLeft = input?.[0];
        const inRight = input?.[1] ?? inLeft;

        if (this.ratio === 1) {
            for (let channel = 0; channel < output.length; channel += 1) {
                const source = input?.[channel] ?? inLeft;
                if (source) output[channel].set(source);
                else output[channel].fill(0);
            }
            return true;
        }

        if (this.interleavedIn.length < frames * 2) this.interleavedIn = new Float32Array(frames * 2);
        if (this.interleavedOut.length < frames * 2) this.interleavedOut = new Float32Array(frames * 2);
        for (let index = 0; index < frames; index += 1) {
            this.interleavedIn[index * 2] = inLeft ? inLeft[index] : 0;
            this.interleavedIn[index * 2 + 1] = inRight ? inRight[index] : 0;
        }
        this.touch.inputBuffer.putSamples(this.interleavedIn, 0, frames);
        this.touch.process();

        const ready = this.touch.outputBuffer.frameCount;
        if (!this.primed && ready >= CUSHION_FRAMES) this.primed = true;
        const outLeft = output[0];
        const outRight = output[1] ?? output[0];
        if (!this.primed || ready < frames) {
            // Starved (a tab in the background, a stall): start the cushion over rather than click.
            if (this.primed && ready < frames) this.primed = false;
            output.forEach(channel => channel.fill(0));
            return true;
        }
        this.touch.outputBuffer.receiveSamples(this.interleavedOut, frames);
        for (let index = 0; index < frames; index += 1) {
            outLeft[index] = this.interleavedOut[index * 2];
            outRight[index] = this.interleavedOut[index * 2 + 1];
        }
        // Keep the cushion from growing without bound if the stretcher ever runs ahead.
        if (this.touch.outputBuffer.frameCount > CUSHION_FRAMES * 4) this.touch.outputBuffer.receive(this.touch.outputBuffer.frameCount - CUSHION_FRAMES);
        return true;
    }
}

registerProcessor('folia-pitch-shift', FoliaPitchShiftProcessor);

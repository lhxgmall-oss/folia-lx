// src/services/audioEffects/pitchShiftWorklet.ts
// AudioWorklet processor for 升降调: moves the pitch of a live stereo stream without moving its tempo,
// using SoundTouch (soundtouchjs, LGPL-2.1) - WSOLA time stretch plus resampling, the same algorithm
// many players use for this. Loaded by pitchShiftNode.ts only once a pitch shift is set.
//
// SoundTouch works on blocks larger than the 128 frames a render quantum carries (one WSOLA sequence
// is ~5000 frames), so the output runs a cushion behind the input (about 130 ms) and is silent until the
// cushion is filled.
//
// Folia LX 0.2.22 (播放断断续续): the old cushion (2048 frames) was smaller than one sequence, a starved
// quantum threw the whole cushion away and went silent until it refilled (~100 ms gap), and anything
// past 8192 frames was cut out of the music. Now: a cushion bigger than a sequence (6144 frames), a starved quantum
// plays what it has and keeps going, and only a backlog over ~1 s (after a real stall) is trimmed.
// soundtouchjs' FIFO also reallocated a new array every time it grew by a few frames - garbage on the
// audio thread - so it now grows with headroom.
import { SoundTouch } from 'soundtouchjs';

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
}

const CUSHION_FRAMES = 6144;
const MAX_BACKLOG_SECONDS = 1;

type FifoLike = {
    _vector: Float32Array; _position: number; _frameCount: number;
    startIndex: number; endIndex: number; rewind: () => void;
};
// Same contract as soundtouchjs' FifoSampleBuffer.ensureCapacity, but grows by doubling (min 16k frames).
const fifoPrototype = Object.getPrototypeOf(new SoundTouch().inputBuffer) as { ensureCapacity: (frames?: number) => void };
fifoPrototype.ensureCapacity = function ensureCapacity(this: FifoLike, numFrames = 0) {
    const minLength = Math.ceil(numFrames) * 2;
    if (this._vector.length < minLength) {
        let length = Math.max(this._vector.length, 32768);
        while (length < minLength * 2) length *= 2;
        const vector = new Float32Array(length);
        vector.set(this._vector.subarray(this.startIndex, this.endIndex));
        this._vector = vector;
        this._position = 0;
    } else {
        this.rewind();
    }
};

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
        if (!this.primed) {
            output.forEach(channel => channel.fill(0));
            return true;
        }
        // Play what is there; a short starve pads with silence instead of dropping the cushion.
        const take = Math.min(frames, ready);
        if (take > 0) this.touch.outputBuffer.receiveSamples(this.interleavedOut, take);
        for (let index = 0; index < frames; index += 1) {
            outLeft[index] = index < take ? this.interleavedOut[index * 2] : 0;
            outRight[index] = index < take ? this.interleavedOut[index * 2 + 1] : 0;
        }
        // Only after a real stall (tab frozen, thread descheduled) can the backlog grow this far.
        const backlog = this.touch.outputBuffer.frameCount;
        if (backlog > sampleRate * MAX_BACKLOG_SECONDS) this.touch.outputBuffer.receive(backlog - CUSHION_FRAMES * 2);
        return true;
    }
}

registerProcessor('folia-pitch-shift', FoliaPitchShiftProcessor);

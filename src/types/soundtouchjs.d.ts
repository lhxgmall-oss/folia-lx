// soundtouchjs ships no types; the pitch-shift worklet uses only this much of it.
declare module 'soundtouchjs' {
    export class SoundTouch {
        pitch: number;
        tempo: number;
        readonly stretch: { sequenceMs: number; seekWindowMs: number; overlapMs: number; setParameters(sampleRate: number, sequenceMs: number, seekWindowMs: number, overlapMs: number): void };
        readonly inputBuffer: { putSamples(samples: Float32Array, position: number, numFrames: number): void };
        readonly outputBuffer: { readonly frameCount: number; receiveSamples(output: Float32Array, numFrames: number): void; receive(numFrames: number): void };
        process(): void;
    }
}

import { describe, expect, it, vi } from 'vitest';

// Runs the pitch-shift processor outside a browser: a 440 Hz tone up an octave must come out near 880 Hz,
// at the same length (pitch moves, tempo does not).
describe('pitch shift worklet', () => {
    it('moves a tone up an octave without changing its length', async () => {
        let Processor: any;
        vi.stubGlobal('sampleRate', 44100);
        vi.stubGlobal('AudioWorkletProcessor', class { port = { onmessage: null as any } });
        vi.stubGlobal('registerProcessor', (_name: string, value: unknown) => { Processor = value; });
        await import('../../../src/services/audioEffects/pitchShiftWorklet');
        const processor = new Processor();
        processor.port.onmessage({ data: { ratio: 2 } });

        const frames = 128;
        const out: number[] = [];
        let phase = 0;
        for (let block = 0; block < 400; block += 1) {
            const input = new Float32Array(frames).map(() => Math.sin((phase++ * 2 * Math.PI * 440) / 44100) * 0.5);
            const output = [new Float32Array(frames), new Float32Array(frames)];
            processor.process([[input, input]], [output]);
            out.push(...output[0]);
        }
        const tail = out.slice(-22050);
        let crossings = 0;
        for (let index = 1; index < tail.length; index += 1) if (tail[index - 1] < 0 && tail[index] >= 0) crossings += 1;
        const hz = crossings / (tail.length / 44100);
        expect(hz).toBeGreaterThan(850);
        expect(hz).toBeLessThan(910);
        vi.unstubAllGlobals();
    });
});

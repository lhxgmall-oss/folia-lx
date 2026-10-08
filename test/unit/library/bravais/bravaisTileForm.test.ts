import { describe, expect, it } from 'vitest';
import { averagePixelColor, resolveArtistToneLight } from '@/library/suites/bravais/bravaisArtistTone';
import { resolveBravaisTileForm, resolveSpineTrackCount } from '@/library/suites/bravais/bravaisTileForm';

// test/unit/library/bravais/bravaisTileForm.test.ts
// 磁贴的种类区分（设计稿 §7.7）：哪种条目画书脊 / 双色调 / 保持海报，书脊上的曲目数，以及双色调亮端的取色换算。

describe('resolveBravaisTileForm', () => {
    it('gives collections a spine, artists a portrait and keeps tracks and the FM stream as posters', () => {
        expect(resolveBravaisTileForm({ kind: 'album' })).toBe('spine');
        expect(resolveBravaisTileForm({ kind: 'playlist' })).toBe('spine');
        expect(resolveBravaisTileForm({ kind: 'folder' })).toBe('spine');
        expect(resolveBravaisTileForm({ kind: 'feed' })).toBe('spine');
        expect(resolveBravaisTileForm({ kind: 'feed', direct: true })).toBe('poster');
        expect(resolveBravaisTileForm({ kind: 'artist' })).toBe('portrait');
        expect(resolveBravaisTileForm({ kind: 'track' })).toBe('poster');
    });

    it('writes the track count only on a spine and only when it is known', () => {
        const label = (count: number) => `${count} 首`;
        expect(resolveSpineTrackCount('spine', 12, label)).toBe('12 首');
        expect(resolveSpineTrackCount('spine', 0, label)).toBeUndefined();
        expect(resolveSpineTrackCount('spine', undefined, label)).toBeUndefined();
        expect(resolveSpineTrackCount('spine', Number.NaN, label)).toBeUndefined();
        expect(resolveSpineTrackCount('portrait', 12, label)).toBeUndefined();
    });
});

describe('artist tone', () => {
    it('averages the opaque pixels', () => {
        const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0]);
        expect(averagePixelColor(pixels)).toEqual({ r: 127.5, g: 0, b: 127.5 });
        expect(averagePixelColor(new Uint8ClampedArray([1, 2, 3, 0]))).toBeNull();
    });

    it('keeps the hue, lifts saturation and lightness, and gives up on colourless photos', () => {
        expect(resolveArtistToneLight({ r: 120, g: 40, b: 40 })).toBe('hsl(0 62% 66%)');
        expect(resolveArtistToneLight({ r: 30, g: 60, b: 110 })).toBe('hsl(218 62% 66%)');
        expect(resolveArtistToneLight({ r: 128, g: 128, b: 130 })).toBeNull();
    });
});

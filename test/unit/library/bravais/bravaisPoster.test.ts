import { describe, expect, it } from 'vitest';
import { getSeamBoundaryX, isSeamBoundaryX } from '@/components/wall/seamPlan';
import { getViewLineX } from '@/components/wall/wallView';
import {
    BRAVAIS_METRICS,
    BRAVAIS_SEAM_FULL_WIDTH,
    BRAVAIS_SEAM_POSTER_MAX_WIDTH,
    BRAVAIS_SEAM_POSTER_MIN_WIDTH,
    BRAVAIS_SEAM_POSTER_WALL_GAP_PX,
} from '@/library/suites/bravais/bravaisConstants';
import { computeBravaisFrame, planPinnedOpening, withTilt } from '@/library/suites/bravais/bravaisFrame';
import {
    resolvePosterWidth,
    resolveSeamTarget,
    resolveVariantWidth,
    type BravaisSeamTargetInput,
} from '@/library/suites/bravais/bravaisSeamTarget';
import { splitHeroWord } from '@/library/suites/bravais/BravaisSeamPoster';
import { rotateCamera } from '@/library/suites/bravais/useBravaisCamera';

// test/unit/library/bravais/bravaisPoster.test.ts
// 歌手页海报：什么时候缝画成海报（只在歌手页、无限拼贴、用户选的完整等级上；过滤框、面板、表单、书脊、折叠都回到原来那套），
// 海报的宽度，钉在左边时每帧的几何（墙不分两半、缝贴着左缘、倾斜绕海报右缘），相机把锚点放在海报右缘之外，
// 以及热门歌名里放大的那个词。

const artistInput = (patch: Partial<BravaisSeamTargetInput> = {}): BravaisSeamTargetInput => ({
    surface: 'artist',
    level: 'full',
    viewportWidth: 1440,
    poster: true,
    ...patch,
});

describe('poster seam target', () => {
    it('draws the artist page at the full level as the poster', () => {
        expect(resolveSeamTarget(artistInput())).toEqual({ width: resolvePosterWidth(1440), variant: 'poster' });
    });

    it('falls back to the plain seam for the filter, the panel, the form and the other levels', () => {
        expect(resolveSeamTarget(artistInput({ filterOpen: true }))).toEqual({ width: BRAVAIS_SEAM_FULL_WIDTH, variant: 'full' });
        expect(resolveSeamTarget(artistInput({ formOpen: true })).variant).toBe('form');
        expect(resolveSeamTarget(artistInput({ panelOpen: true })).variant).toBe('panel');
        expect(resolveSeamTarget(artistInput({ level: 'spine' })).variant).toBe('spine');
        expect(resolveSeamTarget(artistInput({ level: 'hidden' })).variant).toBe('none');
    });

    it('only applies to artist layers that allow it (the finite wall does not)', () => {
        expect(resolveSeamTarget(artistInput({ poster: false })).variant).toBe('full');
        expect(resolveSeamTarget(artistInput({ surface: 'collection' })).variant).toBe('full');
    });

    it('takes 46% of the viewport, clamped', () => {
        expect(resolvePosterWidth(1000)).toBe(BRAVAIS_SEAM_POSTER_MIN_WIDTH);
        expect(resolvePosterWidth(1300)).toBe(598);
        expect(resolvePosterWidth(2560)).toBe(BRAVAIS_SEAM_POSTER_MAX_WIDTH);
        expect(resolveVariantWidth('poster', 1300)).toBe(598);
    });
});

describe('pinned frame', () => {
    const view = { width: 1200, height: 800, scale: 0.5 };

    it('keeps the wall in one piece and pins the seam to the left edge', () => {
        const frame = computeBravaisFrame({
            center: { x: 0, y: 0 }, view, anchorX: 0, openWidth: 560, contentWidth: 560, hidden: false, pinned: true,
        });
        expect(frame.left).toEqual({ x: 600, y: 400 });
        expect(frame.right).toEqual(frame.left);
        expect(frame.seam).toEqual({ x: 280, width: 560, visible: true });
        expect(frame.contentOpacity).toBe(1);
        expect(frame.tab.visible).toBe(false);
    });

    it('tilts around the poster edge at half height', () => {
        const frame = computeBravaisFrame({
            center: { x: 0, y: 0 }, view, anchorX: 0, openWidth: 560, contentWidth: 560, hidden: false, pinned: true, tiltDeg: -10,
        });
        expect(frame.tilt).toEqual({ deg: -10, pivotX: 560, pivotY: 400 });
        expect(withTilt('scale(1)', frame.tilt)).toBe('translate(560px, 400px) rotate(-10deg) translate(-560px, -400px) scale(1)');
        expect(withTilt('scale(1)', { deg: 0, pivotX: 560, pivotY: 400 })).toBe('scale(1)');
    });

    it('puts a block boundary just right of the poster', () => {
        const width = 560;
        const plan = planPinnedOpening({ center: { x: 333, y: 12 }, view, width });
        expect(isSeamBoundaryX(plan.anchorX, BRAVAIS_METRICS)).toBe(true);
        expect(plan.center.y).toBe(12);
        const screenX = getViewLineX(view) + (plan.anchorX - plan.center.x) * view.scale;
        expect(screenX).toBeCloseTo(width + BRAVAIS_SEAM_POSTER_WALL_GAP_PX);
    });

    it('keeps the preferred boundary and only moves the camera', () => {
        const preferX = getSeamBoundaryX(3, BRAVAIS_METRICS);
        const plan = planPinnedOpening({ center: { x: 0, y: 0 }, view, width: 560, preferX });
        expect(plan.anchorX).toBe(preferX);
    });
});

describe('splitHeroWord', () => {
    const hero = (title: string) => splitHeroWord(title).filter(part => part.hero).map(part => part.text);

    it('enlarges the longest word', () => {
        expect(splitHeroWord('Track 20 Amber').map(part => part.text).join('')).toBe('Track 20 Amber');
        expect(hero('Love in the afternoon')).toEqual(['afternoon']);
    });

    it('enlarges nothing when the title is a single word', () => {
        expect(hero('Yesterday')).toEqual([]);
    });
});

describe('rotateCamera', () => {
    it('turns the pan camera with the tilt and back again', () => {
        const camera = { x: 120, y: -40, scale: 0.76 };
        const turned = rotateCamera(camera, -10);
        expect(turned.scale).toBe(0.76);
        expect(Math.hypot(turned.x, turned.y)).toBeCloseTo(Math.hypot(camera.x, camera.y));
        const back = rotateCamera(turned, 10);
        expect(back.x).toBeCloseTo(camera.x);
        expect(back.y).toBeCloseTo(camera.y);
        expect(rotateCamera(camera, 0)).toBe(camera);
    });
});

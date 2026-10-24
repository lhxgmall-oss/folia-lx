import { describe, expect, it } from 'vitest';
import {
    NOW_PLAYING_CARD_BAR_GAP_PX,
    resolveNowPlayingCardBottomPx,
    resolveNowPlayingCardMaxWidthPx,
} from '../../../src/stores/playerControlBarGeometry';

// test/unit/stores/playerControlBarGeometry.test.ts

describe('resolveNowPlayingCardBottomPx', () => {
    it('moves the card above the bar when it reaches into it (portrait phone)', () => {
        // 393px wide: card 24..264, collapsed capsule from 53
        expect(resolveNowPlayingCardBottomPx(32, 24, 240, 53, 48)).toBe(32 + 48 + NOW_PLAYING_CARD_BAR_GAP_PX);
    });

    it('keeps the baseline when the bar is far enough (desktop)', () => {
        // 1440px wide: capsule from ~570
        expect(resolveNowPlayingCardBottomPx(32, 24, 260, 570, 48)).toBe(32);
    });

    it('keeps the baseline while no bar is mounted or the card is not measured yet', () => {
        expect(resolveNowPlayingCardBottomPx(56, 24, 240, Number.POSITIVE_INFINITY, 0)).toBe(56);
        expect(resolveNowPlayingCardBottomPx(56, 24, 240, 53, 0)).toBe(56);
        expect(resolveNowPlayingCardBottomPx(56, 24, 0, 53, 48)).toBe(56);
    });

    it('follows the bar height (expanded capsule)', () => {
        expect(resolveNowPlayingCardBottomPx(56, 24, 240, 16, 132)).toBe(56 + 132 + NOW_PLAYING_CARD_BAR_GAP_PX);
    });
});

describe('resolveNowPlayingCardMaxWidthPx', () => {
    it('squeezes the card to end left of the bar when enough room is left (landscape phone)', () => {
        // card from 77 (24 + cutout), bar from 324
        expect(resolveNowPlayingCardMaxWidthPx(77, 324, 48)).toBe(324 - 77 - NOW_PLAYING_CARD_BAR_GAP_PX);
    });

    it('does not squeeze when the room would be too narrow (portrait phone: card moves up instead)', () => {
        expect(resolveNowPlayingCardMaxWidthPx(24, 53, 48)).toBe(Number.POSITIVE_INFINITY);
    });

    it('does not squeeze without a bar', () => {
        expect(resolveNowPlayingCardMaxWidthPx(24, Number.POSITIVE_INFINITY, 0)).toBe(Number.POSITIVE_INFINITY);
    });
});

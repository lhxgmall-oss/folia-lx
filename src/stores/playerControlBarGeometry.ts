import { motionValue } from 'framer-motion';

// src/stores/playerControlBarGeometry.ts
// Where the bottom-centre player control bar (FloatingPlayerControls) is on screen, for the
// bottom-left now-playing card: on a narrow (portrait phone) screen the two share the same baseline
// and would overlap, so the card moves up above the bar. MotionValues, not store state: the bar
// writes them from a ResizeObserver and nothing re-renders for it.

/** Left edge of the bar's capsule in viewport px; +Infinity while no bar is mounted. */
export const playerControlBarLeft = motionValue(Number.POSITIVE_INFINITY);

/** Height of the bar's capsule in px; 0 while no bar is mounted. */
export const playerControlBarHeight = motionValue(0);

/** Gap kept between the card and the bar when the card moves above it. */
export const NOW_PLAYING_CARD_BAR_GAP_PX = 12;

/**
 * Bottom of the now-playing card: its usual baseline, or above the bar when the card (starting at
 * cardLeftPx, cardWidthPx wide) would reach into the bar's horizontal extent.
 */
export const resolveNowPlayingCardBottomPx = (
    baseBottomPx: number,
    cardLeftPx: number,
    cardWidthPx: number,
    barLeftPx: number,
    barHeightPx: number,
): number => {
    if (!(barHeightPx > 0) || !Number.isFinite(barLeftPx) || !(cardWidthPx > 0)) {
        return baseBottomPx;
    }
    const overlaps = cardLeftPx + cardWidthPx + NOW_PLAYING_CARD_BAR_GAP_PX / 2 > barLeftPx;
    return overlaps ? baseBottomPx + barHeightPx + NOW_PLAYING_CARD_BAR_GAP_PX : baseBottomPx;
};

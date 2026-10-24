// src/services/automix/tempoBend.ts
// Runs a deck at a different tempo without moving its pitch.
//
// Was an AudioWorklet on a false premise: on a media element `preservesPitch` defaults to TRUE, so
// the element's own time stretcher already corrects pitch upstream of where Web Audio taps it. We
// corrected a second time - a 0.75x bend went a fourth sharp, which is what "it goes out of tune"
// was. The file is now just that one property, made explicit rather than left to its default, plus
// the rate. Deleting the worklet also removed its module chunk and twenty milliseconds of deck latency.

/**
 * Sets a deck's tempo, pitch intact.
 *
 * `preservesPitch` is written every time, not once at setup: elements are recycled, and a rate
 * applied while it is false is an audible detune, not a tempo match. Its default is already true, so
 * this only makes the dependency explicit rather than assumed.
 */
import { applyPlaybackTempoToElement, setElementTempoBend } from '../playbackTempo';

// The listener's own speed (services/playbackTempo.ts) is the base: a bend multiplies on top of it,
// and settling puts the deck back on that speed rather than on 1x.

export const applyTempoBend = (
    element: HTMLAudioElement,
    rate: number,
): number => {
    if (!(rate > 0) || Math.abs(rate - 1) < 0.001) {
        resetTempoBend(element);
        return 1;
    }
    setElementTempoBend(element, rate);
    applyPlaybackTempoToElement(element, rate);
    return rate;
};

/** Puts a deck back at its own tempo. Part of every settle, like the gains and the tone are. */
export const resetTempoBend = (element: HTMLAudioElement | null) => {
    if (!element) return;
    setElementTempoBend(element, null);
    applyPlaybackTempoToElement(element);
};

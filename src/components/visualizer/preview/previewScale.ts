// src/components/visualizer/preview/previewScale.ts
// The arithmetic of a small live picture. Several lyric styles lay themselves out from the size of
// the app's window, not of the box they are in, and the Pixi styles never make a canvas smaller
// than 320 by 240. So a picture draws the style on a stage as large as the window, where it lays
// out as on the playing page, and scales that stage down until it covers the picture's box. The
// big sample of the lyric style window does the same, but fits the whole stage into its box.

export type Size = { width: number; height: number };

/** Where the scaled stage sits in the box, from the box's top left corner. */
export type StagePlace = { scale: number; left: number; top: number };

/** Scales a stage by the ratio `pick` chooses of the two and centres it in the box. Null while either has no size. */
const placeStage = (stage: Size, box: Size, pick: (across: number, down: number) => number): StagePlace | null => {
    if (!(stage.width > 0 && stage.height > 0 && box.width > 0 && box.height > 0)) {
        return null;
    }
    const scale = pick(box.width / stage.width, box.height / stage.height);
    return {
        scale,
        left: (box.width - stage.width * scale) / 2,
        top: (box.height - stage.height * scale) / 2,
    };
};

/**
 * Places a stage in a box so that it covers the box: scaled by the larger of the two ratios and
 * centred, so what sticks out is cut evenly at both sides. Null while either has no size.
 */
export const coverStage = (stage: Size, box: Size): StagePlace | null => placeStage(stage, box, Math.max);

/**
 * Places a stage in a box so that all of it shows: scaled by the smaller of the two ratios and
 * centred, so the box is left empty evenly at two sides. Null while either has no size.
 */
export const fitStage = (stage: Size, box: Size): StagePlace | null => placeStage(stage, box, Math.min);

/** A rectangle in a box, from the box's top left corner. */
export type BoxRect = { left: number; top: number; width: number; height: number };

/**
 * Fits a stage into a box (fitStage) and gives the unscaled frame that cuts what of it shows.
 * Under the scale the stage's edges fall between device pixels, and there a layer the compositor
 * draws apart (a style's canvas) is cut at the whole pixel past the edge, while what is painted
 * over it (the dim over a background) fades out inside that pixel: the last column shows the
 * canvas undimmed, a bright line along the edge. The frame lies `edge` inside the stage's edges
 * where the box is left empty, and `edge` past the box's where the stage fills it, so the box cuts
 * it there; an unscaled frame is cut at the same whole pixel for every layer. The stage's place is
 * from the frame's top left corner. Null while either has no size.
 */
export const frameStage = (stage: Size, box: Size, edge: number): { frame: BoxRect; place: StagePlace } | null => {
    if (!(box.width > 0 && box.height > 0)) {
        return null;
    }
    // Fitted into the box grown by two edges at each side: along the side it fills, the stage
    // reaches two edges past the box, and the frame one edge inside the stage, one past the box.
    const fitted = fitStage(stage, { width: box.width + 4 * edge, height: box.height + 4 * edge });
    if (!fitted) {
        return null;
    }
    return {
        frame: {
            left: fitted.left - edge,
            top: fitted.top - edge,
            width: stage.width * fitted.scale - 2 * edge,
            height: stage.height * fitted.scale - 2 * edge,
        },
        place: { scale: fitted.scale, left: -edge, top: -edge },
    };
};

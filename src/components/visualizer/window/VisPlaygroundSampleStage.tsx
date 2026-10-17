import React, { useCallback, useRef } from 'react';
import { MotionConfig } from 'framer-motion';
import { stageStyle, useBoxSize } from '../preview/LivePicture';
import { useLyricPreview } from '../preview/LyricPreviewContext';
import { frameStage } from '../preview/previewScale';

// src/components/visualizer/window/VisPlaygroundSampleStage.tsx
// The stage of the big sample in the lyric style window. Several styles lay themselves out from the
// size of the app's window (window.innerWidth, vw, vh), not of the box they are in, so the sample
// draws them as the small pictures do (LivePicture): on a stage as large as the window, scaled
// down until all of it fits the sample's box. A style there looks like the playing page made
// smaller. Only what is drawn is scaled: the sample's own buttons lie over it, outside this stage.

type VisPlaygroundSampleStageProps = {
    children: React.ReactNode;
};

/**
 * How far inside the stage's edges the unscaled frame cuts it (previewScale.frameStage). One CSS
 * pixel is at least the half device pixel the frame's edge may be rounded outwards by.
 */
const FRAME_EDGE = 1;

const VisPlaygroundSampleStage: React.FC<VisPlaygroundSampleStageProps> = ({ children }) => {
    const { stage } = useLyricPreview();
    const boxRef = useRef<HTMLDivElement>(null);
    const box = useBoxSize(boxRef);
    const framed = box && frameStage(stage, box, FRAME_EDGE);
    const scale = framed?.place.scale ?? 1;
    // framer-motion reads the pointer in the page's pixels: on the scaled stage a drag (Monet's
    // portrait) must move by the stage's pixels to stay under the pointer.
    const toStagePoint = useCallback((point: { x: number; y: number }) => ({ x: point.x / scale, y: point.y / scale }), [scale]);

    return (
        <div ref={boxRef} className="absolute inset-0">
            {framed && (
                // The stage is cut by this unscaled frame, not by its own edges under the scale: see frameStage.
                <div className="absolute overflow-hidden" style={framed.frame}>
                    <div className="absolute origin-top-left" style={stageStyle(stage, framed.place) ?? undefined}>
                        <MotionConfig transformPagePoint={toStagePoint}>{children}</MotionConfig>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VisPlaygroundSampleStage;

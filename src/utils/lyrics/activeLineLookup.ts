import type { Line } from '../../types';

// src/utils/lyrics/activeLineLookup.ts
// Index a lyric snapshot once; frame-time queries preserve overlapping lines and render tails.

type TimedLine = Pick<Line, 'startTime' | 'endTime' | 'renderHints'>;

export const findLatestActiveLineIndex = (lines: readonly TimedLine[], time: number) => {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line || time < line.startTime) continue;
        if (time <= (line.renderHints?.renderEndTime ?? line.endTime)) return index;
    }
    return -1;
};

/** Build an immutable timing snapshot; expired prefixes let queries skip whole interludes. */
export const createActiveLineLookup = (lines: readonly TimedLine[]) => {
    const starts = new Float64Array(lines.length);
    const ends = new Float64Array(lines.length);
    const prefixEnds = new Float64Array(lines.length);
    let latestEnd = -Infinity;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const end = line?.renderHints?.renderEndTime ?? line?.endTime;
        // Preserve the original reverse-array precedence for unnormalized inputs.
        if (!line || !Number.isFinite(line.startTime) || !Number.isFinite(end)
            || (index > 0 && line.startTime < starts[index - 1])) {
            return (time: number) => findLatestActiveLineIndex(lines, time);
        }
        starts[index] = line.startTime;
        ends[index] = end;
        latestEnd = Math.max(latestEnd, end);
        prefixEnds[index] = latestEnd;
    }

    return (time: number) => {
        if (!Number.isFinite(time)) return findLatestActiveLineIndex(lines, time);
        let low = 0;
        let high = starts.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (starts[middle] <= time) low = middle + 1;
            else high = middle;
        }
        for (let index = low - 1; index >= 0 && prefixEnds[index] >= time; index -= 1) {
            if (ends[index] >= time) return index;
        }
        return -1;
    };
};

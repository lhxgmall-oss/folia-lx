import { HTDEMUCS_GPU_SEGMENT, runHtdemucsGpu, type GpuRunOptions, type StemChannels } from './beatThisGpu';

// src/services/analysis/stemRange.ts
// Any stretch of a track's four stems from htdemucs on the GPU, on the one segment grid every caller
// shares, and the segments kept for whoever asks next (analysis service plan, phase 3).
//
// The grid: segment k of a track starts at k x three quarters of a segment from its first sample
// (drumStemSegments), whoever separates it - the drum hits (the whole track, drumStem.ts) or automix
// (its head and tail windows, automix/stems.ts). A stretch is the segments that reach into it, laid
// together with the same triangular window and divided by the same weight as a whole track's, so a
// stretch's samples are the whole track's, bit for bit: every sample gets the same contributions, in
// the same (ascending) order. Before this automix cut its own 30 s window and separated that from
// its own first sample, so no segment of it was ever one of the drum hits'.
//
// The cache: a segment is the model's raw four stems for its 3.9 s (5.5 MB as float), so only those
// someone is known to want are kept, by key and index, in an LRU capped by size (MAX_BYTES):
// - a segment inside a stretch automix has said it wants (`wantStemRange`), separated by anyone - the
//   drum hits reaching a track's tail before automix gets to it;
// - the drums alone (1.4 MB) of a segment automix separated: the drum hits of that track, when it
//   plays, take them instead of running the segment again (its head, separated while the track before
//   was playing).
// Once automix has its stretch (`forgetStemRange`) its segments shrink to their drums. Nothing is
// written to disk: the stems automix keeps are its own (16-bit, its window), the drum hits store hits.
//
// From review: wants are counted (a short track's head and tail are the same stretch, and the first
// one done must not shrink the other's segments); the caller's own stretch does not make it keep its
// own segments whole (it has their sums); a segment being separated is joined, not run twice; and an
// entry remembers the track length it was cut for.
//
// The GPU is deterministic and every caller cuts its segment's input from the same decode (one per
// key and rate, analysis/trackBytes.ts), so a segment taken from here is the segment the caller would
// have separated itself.

/** htdemucs' sources in its order, as the stems come back. */
export const STEM_SOURCES = ['drums', 'bass', 'other', 'vocals'] as const;

/** Where each segment starts, for a track of `total` samples: a step of three quarters of a segment. */
export const stemSegmentStarts = (total: number, segment = HTDEMUCS_GPU_SEGMENT): number[] => {
    const stride = segment - Math.floor(segment / 4);
    const count = Math.max(1, Math.ceil(total / stride));
    const starts: number[] = [];
    for (let c = 0; c < count; c += 1) {
        const start = c * stride;
        if (start >= total && c > 0) break;
        starts.push(start);
    }
    return starts;
};

/** The triangular overlap-add window of htdemucs.cjs `buildWindow`, for one segment. */
export const stemSegmentWindow = (segment: number): Float32Array => {
    const overlap = Math.floor(segment / 4);
    const win = new Float32Array(segment).fill(1);
    for (let i = 0; i < overlap; i += 1) {
        const ramp = i / (overlap - 1);
        win[i] = ramp;
        win[segment - 1 - i] = ramp;
    }
    return win;
};

/** The indices of the segments that reach into [from, to). */
export const segmentsOver = (total: number, from: number, to: number, segment = HTDEMUCS_GPU_SEGMENT): number[] => {
    const starts = stemSegmentStarts(total, segment);
    const out: number[] = [];
    starts.forEach((start, index) => {
        if (start < to && start + segment > from) out.push(index);
    });
    return out;
};

/** The samples a stretch [from, to) needs decoded: from its first segment's start to its last's end. */
export const stemRangeSpan = (total: number, from: number, to: number, segment = HTDEMUCS_GPU_SEGMENT): { start: number; end: number } => {
    const starts = stemSegmentStarts(total, segment);
    const indices = segmentsOver(total, from, to, segment);
    if (indices.length === 0) return { start: from, end: from };
    return { start: starts[indices[0]], end: Math.min(total, starts[indices[indices.length - 1]] + segment) };
};

// --- the segment cache ---

/** The segments kept, across tracks: some 17 segments' four stems. */
const MAX_BYTES = 96 * 1024 * 1024;
interface Kept { stems: StemChannels[]; bytes: number; total: number }
const kept = new Map<string, Kept>();
let keptBytes = 0;
/** Segments being separated, by segment key: a second caller joins rather than runs it again. */
const separating = new Map<string, Promise<StemChannels[] | null>>();
/** The stretches automix wants, by key: [from, to) in samples. */
const wanted = new Map<string, Array<{ from: number; to: number; total: number }>>();

const segmentKey = (key: string, index: number) => `${key}#${index}`;
const bytesOf = (stems: StemChannels[]) => stems.reduce((sum, stem) => sum + stem.left.byteLength + stem.right.byteLength, 0);

const keep = (id: string, stems: StemChannels[], total: number) => {
    const previous = kept.get(id);
    if (previous) {
        keptBytes -= previous.bytes;
        kept.delete(id);
    }
    const entry = { stems, bytes: bytesOf(stems), total };
    kept.set(id, entry);
    keptBytes += entry.bytes;
    while (keptBytes > MAX_BYTES) {
        const oldest = kept.keys().next().value;
        if (oldest === undefined) break;
        keptBytes -= kept.get(oldest)!.bytes;
        kept.delete(oldest);
    }
};

/** A kept segment's stems (all four, or the drums alone), marked as just used; null when not kept. */
export const peekStemSegment = (key: string, index: number, total?: number): StemChannels[] | null => {
    const id = segmentKey(key, index);
    const found = kept.get(id);
    if (!found || (total !== undefined && found.total !== total)) return null;
    kept.delete(id);
    kept.set(id, found);
    return found.stems;
};

/** Whether a wanted stretch takes in segment `index`, leaving out one want of `except` (the caller's own). */
const inWantedRange = (key: string, index: number, total: number, except?: { from: number; to: number }) => {
    let skipped = false;
    return (wanted.get(key) ?? []).some((range) => {
        if (except && !skipped && range.from === except.from && range.to === except.to && range.total === total) {
            skipped = true;
            return false;
        }
        return range.total === total && segmentsOver(total, range.from, range.to).includes(index);
    });
};

/**
 * Says automix wants the stems of [from, to) of `key` (a track of `total` samples): a segment in it
 * that anyone separates meanwhile is kept whole for it.
 */
export const wantStemRange = (key: string, from: number, to: number, total: number): void => {
    // Counted: the same stretch wanted twice is forgotten twice.
    const ranges = wanted.get(key) ?? [];
    ranges.push({ from, to, total });
    wanted.set(key, ranges);
};

/**
 * Automix has the stretch (or no longer wants it): its segments shrink to their drums, which the drum
 * hits of the track may still take, unless another wanted stretch needs them whole.
 */
export const forgetStemRange = (key: string, from: number, to: number, total: number): void => {
    const ranges = wanted.get(key) ?? [];
    const at = ranges.findIndex(range => range.from === from && range.to === to && range.total === total);
    if (at >= 0) ranges.splice(at, 1);
    if (ranges.length) wanted.set(key, ranges);
    else wanted.delete(key);
    for (const index of segmentsOver(total, from, to)) {
        const id = segmentKey(key, index);
        const found = kept.get(id);
        if (found && found.stems.length > 1 && !inWantedRange(key, index, total)) keep(id, [found.stems[0]], total);
    }
};

/** Who is separating: what it keeps for the others differs (see the header). */
export type StemSeparator = 'drums' | 'stems';

/**
 * One segment of `key` (a track of `total` samples): from the cache, or separated now on the GPU
 * from `inLeft`/`inRight` (the segment's input, zero-padded past the end, exactly
 * HTDEMUCS_GPU_SEGMENT long). Kept for the others as the header says. Null when the GPU cannot.
 */
export const separateStemSegment = async (
    key: string | undefined,
    index: number,
    total: number,
    inLeft: Float32Array,
    inRight: Float32Array,
    by: StemSeparator,
    options: GpuRunOptions,
    /** The caller's own stretch: wanting it does not keep its segments whole for itself. */
    own?: { from: number; to: number },
): Promise<StemChannels[] | null> => {
    const cached = key ? peekStemSegment(key, index, total) : null;
    if (cached && (by === 'drums' || cached.length === STEM_SOURCES.length)) return cached;
    const id = key ? segmentKey(key, index) : null;
    const running = id ? separating.get(id) : undefined;
    if (running) {
        const joined = await running;
        if (joined && (by === 'drums' || joined.length === STEM_SOURCES.length)) return joined;
    }
    const run = (async () => {
        const result = await runHtdemucsGpu(inLeft, inRight, { ...options, key: options.key ?? key });
        if (!result) return null;
        return result.stems ?? [{ left: result.left, right: result.right }];
    })();
    if (id) separating.set(id, run);
    let stems: StemChannels[] | null;
    try {
        stems = await run;
    } finally {
        if (id && separating.get(id) === run) separating.delete(id);
    }
    if (!stems) return null;
    if (key && id) {
        if (inWantedRange(key, index, total, own) && stems.length === STEM_SOURCES.length) keep(id, stems, total);
        else if (by === 'stems') keep(id, [stems[0]], total);
    }
    return stems;
};

/**
 * The four stems of [from, to) of a track of `total` samples, each [to - from] stereo, from the GPU,
 * on the shared grid (see the header). `left`/`right` hold the decoded track from `offset` on, at
 * least over `stemRangeSpan(total, from, to)`. Null as soon as a segment cannot be separated or
 * `stillWanted` says no (asked before each).
 */
export const separateStemRange = async ({ key, left, right, offset, total, from, to, options, deadlineOf }: {
    key?: string;
    left: Float32Array;
    right: Float32Array;
    offset: number;
    total: number;
    from: number;
    to: number;
    options: GpuRunOptions;
    /** The deadline as it stands at each segment (it can arrive or move after the stretch is asked for). */
    deadlineOf?: () => number | undefined;
}): Promise<StemChannels[] | null> => {
    const segment = HTDEMUCS_GPU_SEGMENT;
    const starts = stemSegmentStarts(total, segment);
    const indices = segmentsOver(total, from, to, segment);
    const length = Math.max(0, to - from);
    const win = stemSegmentWindow(segment);
    const sums = STEM_SOURCES.map(() => ({ left: new Float32Array(length), right: new Float32Array(length) }));
    const weight = new Float32Array(length);
    const inLeft = new Float32Array(segment);
    const inRight = new Float32Array(segment);
    for (let at = 0; at < indices.length; at += 1) {
        const index = indices[at];
        if (options.stillWanted && !options.stillWanted()) return null;
        const start = starts[index];
        const n = Math.min(segment, total - start);
        if (start - offset < 0 || start - offset + n > left.length) throw new Error(`stem range: segment ${index} (${start}+${n}) is outside the decoded ${offset}+${left.length}`);
        inLeft.fill(0);
        inRight.fill(0);
        inLeft.set(left.subarray(start - offset, start - offset + n));
        inRight.set(right.subarray(start - offset, start - offset + n));
        const stems = await separateStemSegment(key, index, total, inLeft, inRight, 'stems', {
            ...options, deadline: deadlineOf?.() ?? options.deadline, unitsLeft: indices.length - at,
        }, { from, to });
        if (!stems || stems.length < STEM_SOURCES.length) return null;
        // Only the samples of the stretch; in the same order a whole track's would be summed.
        const first = Math.max(start, from);
        const last = Math.min(start + n, to);
        for (let s = 0; s < STEM_SOURCES.length; s += 1) {
            const stem = stems[s];
            const sum = sums[s];
            for (let i = first; i < last; i += 1) {
                sum.left[i - from] += stem.left[i - start] * win[i - start];
                sum.right[i - from] += stem.right[i - start] * win[i - start];
            }
        }
        for (let i = first; i < last; i += 1) weight[i - from] += win[i - start];
    }
    for (const sum of sums) {
        for (let i = 0; i < length; i += 1) {
            const w = Math.max(weight[i], 1e-8);
            sum.left[i] /= w;
            sum.right[i] /= w;
        }
    }
    return sums;
};

/** Test-only: forgets every kept segment and wanted stretch. */
export const resetStemSegmentsForTests = (): void => {
    kept.clear();
    keptBytes = 0;
    wanted.clear();
    separating.clear();
};

import { createActiveLineLookup, findLatestActiveLineIndex } from '../../src/utils/lyrics/activeLineLookup.ts';

// test/manual/playback-line-lookup-benchmark.mjs
// Node 24+: node test/manual/playback-line-lookup-benchmark.mjs
// Measures lyric lookup only; these timings are not whole-app CPU or GPU measurements.

const queries = 100_000;
const measure = (lookup, times) => {
    let sum = 0;
    const start = performance.now();
    for (const time of times) sum += lookup(time);
    return { ms: performance.now() - start, sum };
};
const median = values => values.sort((a, b) => a - b)[2];

for (const count of [300, 1200, 5000]) {
    const lines = Array.from({ length: count }, (_, index) => ({ startTime: index * 2, endTime: index * 2 + 1.7 }));
    const indexed = createActiveLineLookup(lines);
    const baseline = time => findLatestActiveLineIndex(lines, time);
    const times = Float64Array.from({ length: queries }, (_, index) => ((index * 3571) % queries) / queries * count * 2);
    measure(indexed, times); measure(baseline, times);
    const before = [], after = [];
    for (let repeat = 0; repeat < 5; repeat += 1) {
        const original = measure(baseline, times), optimized = measure(indexed, times);
        if (original.sum !== optimized.sum) throw new Error('Lookup results differ');
        before.push(original.ms); after.push(optimized.ms);
    }
    const originalMs = median(before), indexedMs = median(after);
    console.log(JSON.stringify({
        lines: count, queries, originalMs: +originalMs.toFixed(2), indexedMs: +indexedMs.toFixed(2),
        speedup: +(originalMs / indexedMs).toFixed(1),
    }));
}

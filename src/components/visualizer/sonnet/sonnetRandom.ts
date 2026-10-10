// src/components/visualizer/sonnet/sonnetRandom.ts
// Supplies deterministic selection without relying on process-global random state.
export {
    hashVisualizerSeed as hashSonnetSeed,
    mixVisualizerSeed as mixSonnetSeed,
    visualizerHash01 as sonnetHash01,
} from '../visualizerSeedHash';

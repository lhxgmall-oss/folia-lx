import { customAdapter } from './custom.mjs';

// shared/ai/mimo.mjs
// Xiaomi MiMo, pay-as-you-go (api.xiaomimimo.com). Every *.xiaomimimo.com host is recognised, the
// Token Plan one included, but Token Plan gets no site: like Qwen's Coding Plan it is for coding
// tools. Its own request rules have not landed yet, so until then the requests are exactly the
// custom adapter's.

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const mimoAdapter = {
    ...customAdapter,
    id: 'mimo',
    label: 'Xiaomi MiMo',
    hosts: [],
    hostSuffixes: ['.xiaomimimo.com'],
    endpoints: [{ id: 'default', baseUrl: 'https://api.xiaomimimo.com/v1' }],
    recommendedModel: 'mimo-v2.6-flash',
};

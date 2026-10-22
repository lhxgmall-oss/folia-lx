import { customAdapter } from './custom.mjs';

// shared/ai/kimi.mjs
// Moonshot's Kimi: the China site (api.moonshot.cn) and the international one (api.moonshot.ai),
// whose keys do not work on each other. Its own request rules have not landed yet, so until then the
// requests are exactly the custom adapter's.

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const kimiAdapter = {
    ...customAdapter,
    id: 'kimi',
    label: 'Kimi',
    hosts: ['api.moonshot.cn', 'api.moonshot.ai'],
    endpoints: [
        { id: 'cn', baseUrl: 'https://api.moonshot.cn/v1' },
        { id: 'global', baseUrl: 'https://api.moonshot.ai/v1' },
    ],
    recommendedModel: 'kimi-k2.6',
};

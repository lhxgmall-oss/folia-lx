import { customAdapter } from './custom.mjs';

// shared/ai/tencentcloud.mjs
// Tencent Cloud TokenHub. The China site's documentation names tencentmaas.com, the international
// account documentation (intl.cloud.tencent.com, tencentcloud.com; rechecked 2026-10-22) names
// tencentcloudmaas.com; both families are recognised, and the international site uses the latter.
// The retired lkeap and Hunyuan addresses are not claimed and fall back to custom. TokenHub resells
// other vendors' models under its own rules, so this adapter never borrows theirs. Its own request
// rules have not landed yet, so until then the requests are exactly the custom adapter's.

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const tencentcloudAdapter = {
    ...customAdapter,
    id: 'tencentcloud',
    label: 'Tencent Cloud TokenHub',
    hosts: [
        'tokenhub.tencentmaas.com',
        'tokenhub-intl.tencentmaas.com',
        'tokenhub.tencentmaas.cn',
        'tokenhub-intl.tencentmaas.cn',
        'tokenhub.tencentcloudmaas.com',
        'tokenhub-intl.tencentcloudmaas.com',
        'tokenhub-us.tencentcloudmaas.tech',
    ],
    endpoints: [
        { id: 'cn', baseUrl: 'https://tokenhub.tencentmaas.com/v1' },
        { id: 'global', baseUrl: 'https://tokenhub-intl.tencentcloudmaas.com/v1' },
    ],
    recommendedModel: 'deepseek-v4-flash',
};

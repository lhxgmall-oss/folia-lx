import { customAdapter } from './custom.mjs';

// shared/ai/qwen.mjs
// Alibaba Cloud Model Studio (Qwen) in compatible mode. Keys are bound to their region, so each
// region is its own site; workspace-dedicated domains end in .maas.aliyuncs.com. Coding Plan and
// Token Plan are for AI coding tools only and get no site. Its own request rules have not landed
// yet, so until then the requests are exactly the custom adapter's.

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const qwenAdapter = {
    ...customAdapter,
    id: 'qwen',
    label: 'Alibaba Cloud Qwen',
    hosts: [
        'dashscope.aliyuncs.com',
        'dashscope-intl.aliyuncs.com',
        'dashscope-us.aliyuncs.com',
        'cn-hongkong.dashscope.aliyuncs.com',
    ],
    hostSuffixes: ['.maas.aliyuncs.com'],
    endpoints: [
        { id: 'cn', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
        { id: 'singapore', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
        { id: 'us', baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1' },
        { id: 'hongkong', baseUrl: 'https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1' },
    ],
    recommendedModel: 'qwen3.8-flash',
};

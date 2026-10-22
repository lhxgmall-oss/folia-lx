import { COMPATIBLE_MODEL_CATALOGUE } from './compatibleBody.mjs';
import { customAdapter } from './custom.mjs';

// shared/ai/glm.mjs
// Zhipu GLM: open.bigmodel.cn in China and Z.ai (api.z.ai) internationally. A Coding Plan address
// typed into the custom URL is still recognised by its host. Its own request rules have not landed
// yet, so until then the requests are exactly the custom adapter's.

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const glmAdapter = {
    ...customAdapter,
    id: 'glm',
    label: 'Zhipu GLM',
    hosts: ['open.bigmodel.cn', 'api.z.ai'],
    endpoints: [
        { id: 'cn', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
        { id: 'global', baseUrl: 'https://api.z.ai/api/paas/v4' },
    ],
    recommendedModel: 'glm-5.2',
    // The model-centre catalogue the settings form has listed so far (as in LobeHub's ZhiPu runtime),
    // paged by page number.
    models: {
        ...COMPATIBLE_MODEL_CATALOGUE,
        path: '/api/fine-tuning/model_center/list',
        query: { pageSize: '100', pageNum: '1' },
    },
};

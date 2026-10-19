import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { qishuiCatalog } from '@/services/onlineMusic/qishui/qishuiCatalog';
import { track } from './fixtures';

// Run the actual npm package through the host bridge and renderer adapter; replace only HTTP responses.
const { createQishuiApiBridge } = createRequire(import.meta.url)('../../../electron/qishui/qishuiApiBridge.cjs');
afterEach(() => vi.unstubAllGlobals());
describe('Qishui package-to-adapter paging', () => {
    it('uses opaque upstream cursors while exposing exact row offsets to the library', async () => {
        const values = new Map<string, unknown>();
        const store = { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
        const cursors: string[] = [];
        const fetch = vi.fn(async (raw: string, options: { body?: string }) => {
            const url = new URL(raw);
            if (url.pathname.endsWith('/client/token/get/')) return Response.json({ client_token: 'fixture-client-token' });
            expect(url.pathname.endsWith('/playlist/detail/')).toBe(true);
            const body = JSON.parse(options.body!);
            cursors.push(body.cursor);
            return Response.json({ data: body.cursor === '0'
                ? { media_entities: [1, 2, 3].map(id => ({ track_entity: track(String(id)) })), has_more: true, next_cursor: 'opaque:next' }
                : { media_entities: [4, 5].map(id => ({ track_entity: track(String(id)) })), has_more: false } });
        });
        const bridge = createQishuiApiBridge({ store, fetch });
        vi.stubGlobal('window', { electron: { qishuiRequest: bridge.request } });
        const page = await qishuiCatalog.getPlaylistTracks!('99', 3, 2);
        expect(page.items.map(song => String(song.id))).toEqual(['3', '4', '5']);
        expect(page).toMatchObject({ hasMore: false, nextOffset: 5 });
        expect(cursors).toEqual(['0', 'opaque:next']);
    });
});

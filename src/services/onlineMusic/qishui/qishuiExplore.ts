import i18n from '../../../i18n/config';
import type { OnlineExploreProvider, ProviderExploreItem } from '../../../types/onlineMusic';
import { createHandedOut, cursorWords, stampCursor } from '../exploreReads';
import { normalizeQishuiSong } from './qishuiNormalize';
import { requestQishui } from './qishuiTransport';

// Qishui's own recommendation stream, independent of the personal-FM queue.
let read = 0;
let batches = 0;
let handedOut = createHandedOut();
export function clearQishuiExplore() { read++; batches = 0; handedOut = createHandedOut(); }
async function nextItems(first: boolean): Promise<{ items: ProviderExploreItem[]; hasMore: boolean }> {
    const data = await requestQishui<{ items: unknown[]; hasMore: boolean }>('feed', { queue: 'explore', first, limit: 20 });
    const songs = handedOut.inTurn('stream', data.items.map(normalizeQishuiSong), song => String(song.id));
    handedOut.note('stream', songs.map(song => String(song.id)));
    return { items: songs.map(song => ({ kind: 'song', song })), hasMore: data.hasMore };
}
export const qishuiExplore: OnlineExploreProvider = {
    async getFeed(cursor) {
        if (cursor) return { sections: [] };
        const mine = ++read;
        const page = await nextItems(true);
        if (mine !== read) return { sections: [] };
        batches = 1;
        console.info('[Qishui] Explore stream read', { count: page.items.length });
        return { sections: [{ id: 'stream', title: i18n.t('qishui.recommended'), items: page.items,
            ...(page.hasMore ? { moreCursor: stampCursor(mine, 'stream') } : {}) }], refreshReadsAnew: true };
    },
    async getSectionItems(cursor) {
        if (cursorWords(cursor, read) !== 'stream' || batches >= 10) return { items: [] };
        const mine = read;
        const page = await nextItems(false);
        if (mine !== read) return { items: [] };
        batches++;
        return { items: page.items, ...(page.hasMore && batches < 10 ? { moreCursor: stampCursor(mine, 'stream') } : {}) };
    },
};

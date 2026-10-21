import type { OmniPage } from '@/types/onlineMusic';
import { foliumOmniError } from '../../folium/omni/service';

// src/mods/runtime/omni/omniPaging.ts
// The pages of `folium.omni` lists (Folium 1.7): opaque cursors the host hands out, and the slicing behind
// them. Sources page differently (one answers a whole album whatever is asked, one caps its pages and
// turns offsets into page numbers, one walks a cursor of its own), so a mod never sees an offset: the host
// hands the source back only the `nextOffset` that source answered, keeps the page length the first page
// set, and gives out at most that many items a page, keeping what the source gave beyond them for the
// next page.

/** Cursors kept, the least recently used dropped first. */
const MAX_CURSORS = 500;
/** Items a cursor keeps of what a source gave beyond a page; past it they are asked for again. */
const MAX_LEFTOVER = 1000;

/**
 * Which list a run of pages belongs to: the method, the source, and the query or the host collection.
 * Two lists are the same when all three are (the subject compared by identity).
 */
export interface FoliumOmniList {
    readonly method: string;
    readonly providerId: string;
    readonly subject: unknown;
}

interface CursorState {
    readonly list: FoliumOmniList;
    /** The offset to hand the source for what comes after `leftover`, as the source answered it. */
    readonly providerOffset: number;
    /** Whether the source said it has more after `providerOffset`. */
    readonly providerHasMore: boolean;
    /** The page length the first page set. */
    readonly limit: number;
    /** What the source gave that was not handed out yet, in its order. */
    readonly leftover: readonly unknown[];
    /** The whole list's length as the source last said it; null when it did not. */
    readonly total: number | null;
}

const cursors = new Map<string, CursorState>();
let cursorCounter = 0;

const mintCursor = (state: CursorState): string => {
    cursorCounter += 1;
    const cursor = `cursor-${cursorCounter.toString(36)}`;
    cursors.set(cursor, state);
    if (cursors.size > MAX_CURSORS) {
        const oldest = cursors.keys().next().value;
        if (oldest !== undefined) cursors.delete(oldest);
    }
    return cursor;
};

/* The state of a cursor, marked as just used; undefined when it is unknown or was dropped. */
const takeCursor = (cursor: string): CursorState | undefined => {
    const state = cursors.get(cursor);
    if (state) {
        cursors.delete(cursor);
        cursors.set(cursor, state);
    }
    return state;
};

const sameList = (a: FoliumOmniList, b: FoliumOmniList) => (
    a.method === b.method && a.providerId === b.providerId && a.subject === b.subject
);

/** The list a cursor belongs to, without using it; null when it is unknown or was dropped. */
export const peekFoliumOmniCursorList = (cursor: string): FoliumOmniList | null => cursors.get(cursor)?.list ?? null;

/** One page as the host layer projects it. */
export interface FoliumOmniSlice<T> {
    readonly items: T[];
    readonly nextCursor: string | null;
    readonly total: number | null;
}

export interface FoliumOmniPageRead<T> {
    readonly list: FoliumOmniList;
    /** The cursor of a later page; null for the first. */
    readonly cursor: string | null;
    /** The page length; read only for the first page, later pages keep the first page's. */
    readonly limit: number;
    /** Asks the source for one page (through the request gate): `limit` items from its `offset`. */
    readonly fetch: (page: { limit: number; offset: number }) => Promise<OmniPage<T>>;
    /** Which of the source's items the list holds at all (others are dropped before paging). */
    readonly keep?: (item: T) => boolean;
}

/**
 * One page of a list. Rejects `stale-ref` for a cursor that no longer resolves, and with a TypeError for
 * a cursor of another list. What the source still owes from an earlier answer is handed out first; the
 * source is asked only when that is short of a page and the source said it has more, once per page at
 * most: a page it answers empty while saying it has more comes out empty, with a cursor, rather than
 * the host asking again on the mod's behalf.
 */
export const readFoliumOmniPage = async <T>(read: FoliumOmniPageRead<T>): Promise<FoliumOmniSlice<T>> => {
    let state: CursorState;
    if (read.cursor === null) {
        state = { list: read.list, providerOffset: 0, providerHasMore: true, limit: read.limit, leftover: [], total: null };
    } else {
        const found = takeCursor(read.cursor);
        if (!found) throw foliumOmniError('stale-ref');
        if (!sameList(found.list, read.list)) throw new TypeError('invalid-arguments: cursor is for another list');
        state = found;
    }
    const { limit } = state;
    let available = state.leftover as T[];
    let { providerOffset, providerHasMore, total } = state;

    if (available.length < limit && providerHasMore) {
        const answer = await read.fetch({ limit, offset: providerOffset });
        const answered = Array.isArray(answer?.items) ? answer.items : [];
        const items = read.keep ? answered.filter(read.keep) : answered;
        available = [...available, ...items];
        const nextOffset = Number.isFinite(answer?.nextOffset) ? answer.nextOffset : providerOffset + answered.length;
        providerOffset = nextOffset;
        providerHasMore = Boolean(answer?.hasMore);
        if (typeof answer?.total === 'number' && Number.isFinite(answer.total) && answer.total >= 0) total = answer.total;
        // More than a cursor keeps: the rest is asked for again, from the first one dropped. This counts
        // items as offsets do, which holds for the sources that answer more than they are asked for.
        if (available.length > limit + MAX_LEFTOVER) {
            const dropped = available.length - (limit + MAX_LEFTOVER);
            available = available.slice(0, limit + MAX_LEFTOVER);
            providerOffset = Math.max(0, nextOffset - dropped);
            providerHasMore = true;
        }
    }

    const items = available.slice(0, limit);
    const leftover = available.slice(limit);
    const nextCursor = leftover.length > 0 || providerHasMore
        ? mintCursor({ list: state.list, providerOffset, providerHasMore, limit, leftover, total })
        : null;
    return { items, nextCursor, total };
};

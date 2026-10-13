import { describe, expect, it } from 'vitest';
import type { BravaisItem } from '@/library/suites/bravais/bravaisLayer';
import {
    BRAVAIS_ALBUM_MOSAIC_PX,
    assignAlbumCoverArt,
    findCoverSpots,
    mosaicPlacement,
    shardPlacement,
} from '@/library/suites/bravais/bravaisAlbumWall';

// test/unit/library/bravais/bravaisAlbumWall.test.ts
// 专辑墙的两种画法：全是同一张封面 → 整面墙拼贴；带单曲封面 → 每张封面第一次出现完整画、重复的与没有封面的切成碎片
// （没有封面的切专辑封面）；顺序不动。碎片切在封面上细节最多的地方，切出来的那一块不露出封面以外。

const track = (key: string, coverUrl?: string): BravaisItem => ({ key, kind: 'track', title: key, subtitle: '', badge: '', coverUrl });

describe('album cover art', () => {
    it('makes a mosaic when every track shares the album cover (sizes and query strings aside)', () => {
        const items = assignAlbumCoverArt([track('a', 'c.jpg?param=200y200'), track('b', 'c.jpg'), track('c')], 'c.jpg?param=512y512');
        expect(items.map(item => item.coverArt)).toEqual(Array(3).fill({ mode: 'mosaic', url: 'c.jpg?param=512y512' }));
    });

    it('keeps the first of each cover, shards the repeats and the coverless, and keeps the order', () => {
        const items = assignAlbumCoverArt(
            [track('a', 'album.jpg'), track('b', 'single.jpg'), track('c', 'album.jpg'), track('d'), track('e', 'single.jpg?x=1')],
            'album.jpg',
        );
        expect(items.map(item => item.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(items.map(item => item.coverArt?.mode ?? 'full')).toEqual(['full', 'full', 'shard', 'shard', 'shard']);
        expect(items[3]).toMatchObject({ coverUrl: 'album.jpg', coverArt: { url: 'album.jpg' } });
        expect(items[4].coverArt?.url).toBe('single.jpg?x=1');
    });

    it('leaves the wall alone when there is no cover at all', () => {
        const items = [track('a'), track('b')];
        expect(assignAlbumCoverArt(items, undefined)).toBe(items);
    });
});

describe('cover spots', () => {
    const side = 50;
    const pixels = (paint: (x: number, y: number) => number) => {
        const data = new Uint8ClampedArray(side * side * 4);
        for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
            const value = paint(x, y);
            data.set([value, value, value, 255], (y * side + x) * 4);
        }
        return data;
    };

    it('finds the busy corner of an otherwise flat cover', () => {
        const spots = findCoverSpots(pixels((x, y) => (x > 34 && y > 34 && (x + y) % 2 === 0 ? 255 : 30)), side);
        expect(spots[0].x).toBeGreaterThan(0.6);
        expect(spots[0].y).toBeGreaterThan(0.6);
    });

    it('falls back to the middle for a flat cover', () => {
        expect(findCoverSpots(pixels(() => 120), side)[0]).toEqual({ x: 0.5, y: 0.5 });
    });
});

describe('placements', () => {
    it('wraps the mosaic by the tile position in the world', () => {
        expect(mosaicPlacement({ x: 100, y: -40 })).toEqual({ size: BRAVAIS_ALBUM_MOSAIC_PX, x: -100, y: -(BRAVAIS_ALBUM_MOSAIC_PX - 40) });
    });

    it('zooms a shard into the cover without showing past its edge', () => {
        const rect = { width: 300, height: 200 };
        for (const seed of ['a', 'b', 'c', 'd']) {
            const placement = shardPlacement([{ x: 0.95, y: 0.05 }, { x: 0.1, y: 0.9 }], seed, rect);
            expect(placement).toEqual(shardPlacement([{ x: 0.95, y: 0.05 }, { x: 0.1, y: 0.9 }], seed, rect));
            expect(placement.size).toBeGreaterThanOrEqual(600);
            expect(placement.x).toBeLessThanOrEqual(0);
            expect(placement.y).toBeLessThanOrEqual(0);
            expect(placement.x + placement.size).toBeGreaterThanOrEqual(rect.width);
            expect(placement.y + placement.size).toBeGreaterThanOrEqual(rect.height);
        }
    });
});

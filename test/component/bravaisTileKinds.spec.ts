import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/bravaisTileKinds.spec.ts
// bravais 磁贴的种类区分（设计稿 §7.7），挂 bravaisKinds 探针（真实 BravaisStage + 歌曲 / 专辑 / 歌单 / 歌手 / 特殊卡混排、
// 合成封面）：
// - 集合（专辑、歌单、文件夹、每日推荐）左侧一条书脊，竖排曲目数（未知时不写字），类型标签（含特殊集合的强调色标签）与
//   标题右移让开；副标题不再重复曲目数，可访问名里还有；歌曲与私人 FM 没有书脊；
// - 歌手是双色调人像：亮端取自头像（同源封面取得到），没有头像 / 头像加载不出来时回退到主题强调色；悬停、键盘焦点、
//   正在播放时恢复原色；名字放大、不显示副标题；
// - 与状态叠加：叠色在双色调之上、书脊之下，熄灯层在两者之上；全透明档书脊退化成遮罩色（熄灯时压到 0.28）、歌手不做双色调；
//   书脊与双色调都在翻牌转的内容层里。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });

type KindsProps = {
    theme?: 'midnight' | 'daylight' | 'vivid';
    look?: 'solid' | 'partial' | 'clear';
    lights?: 'on' | 'off';
    tint?: 'on' | 'off';
    current?: string;
    mix?: 'mixed' | 'artists';
    extraArtistCover?: string;
};

/** 跨源、不带 CORS 头的头像：图片照常显示，但读不了像素。 */
const CORS_BLOCKED_COVER = 'http://kinds-cors.localhost:4196/portrait.png';
/** 2×2 的红色 PNG。 */
const RED_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP4z8DwnwGM/zMwAAAf7gP9NRsAMwAAAABJRU5ErkJggg==', 'base64');

const mountKinds = async (mount: (story: string, props?: Record<string, unknown>) => Promise<unknown>, page: Page, props: KindsProps = {}) => {
    await mount('bravaisKinds', props);
    await expect.poll(() => page.evaluate(() => window.__bravaisKindsProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await settled(page);
    await page.mouse.move(2, 600);
};

/** 一张此刻完整在视口里、没被缝挡住的磁贴（按选择器挑），返回它的 slot。 */
const visibleSlot = (page: Page, selector: string) => page.evaluate((query) => {
    const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
    const fits = (rect: DOMRect) => rect.left > 8 && rect.top > 8
        && rect.right < window.innerWidth - 8 && rect.bottom < window.innerHeight - 8
        && (!seamRect || seamRect.width < 1 || rect.right < seamRect.left - 4 || rect.left > seamRect.right + 4);
    const tile = [...document.querySelectorAll<HTMLElement>(query)].find(element => fits(element.getBoundingClientRect()));
    return tile?.dataset.bravaisSlot ?? null;
}, selector);

const tileAt = (page: Page, slot: string) => page.locator(`.bravais-tile[data-bravais-slot="${slot}"]`);
const card = (page: Page, key: string) => page.locator(`.bravais-tile[data-library-card="${key}"]`).first();
const style = (locator: Locator, property: string, pseudo?: string) => locator.evaluate(
    (node, [name, element]) => getComputedStyle(node, element || null).getPropertyValue(name),
    [property, pseudo ?? ''] as const,
);
/** 在内容层里的 left（标签与文字块都是内容层的绝对定位子元素）。 */
const leftWithinFace = (locator: Locator) => locator.evaluate(node => Math.round(Number.parseFloat(getComputedStyle(node).left)));
const duoOpacity = (locator: Locator) => locator.locator('.bravais-tile-duo').evaluate(node => Number(getComputedStyle(node).opacity));

test.describe('[bravais-only] tile kinds', () => {
    test('collections wear a spine with the track count; songs and the FM stream stay full posters', async ({ mount, page }) => {
        await mountKinds(mount, page);
        const album = card(page, 'card:album:a0');
        await expect(album).toHaveAttribute('data-bravais-form', 'spine');
        const spine = album.locator('.bravais-tile-face > .bravais-tile-spine');
        await expect(spine).toHaveCount(1);
        await expect(spine).toHaveText('12 tracks');
        await expect(spine).toHaveAttribute('aria-hidden', 'true');
        expect(await style(spine, 'width')).toBe('18px');
        // 书脊里是封面左缘那一条（压暗），文字竖排。
        await expect(spine.locator('i')).toHaveCount(1);
        expect(await style(spine.locator('i'), 'filter')).toBe('brightness(0.42) saturate(1.25)');
        expect(await style(spine.locator('span'), 'writing-mode')).toBe('vertical-rl');
        // 类型标签与标题右移让开书脊；副标题不再重复曲目数，可访问名里还有。
        expect(await leftWithinFace(album.locator('.lattice-poster-badge'))).toBe(30);
        expect(await leftWithinFace(album.locator('.lattice-poster-copy'))).toBe(33);
        await expect(album.locator('.lattice-poster-copy small')).toHaveText('YOASOBI · 2021');
        await expect(album.locator('article')).toHaveAttribute('aria-label', 'THE BOOK · YOASOBI · 2021 · 12 tracks');

        await expect(card(page, 'card:playlist:p0').locator('.bravais-tile-spine')).toHaveText('48 tracks');
        await expect(card(page, 'card:folder:folder-Music').locator('.bravais-tile-spine')).toHaveText('42 tracks');
        await expect(card(page, 'card:daily_recommendations:daily_recommendations').locator('.bravais-tile-spine')).toHaveText('30 tracks');
        // 曲目数未知：有书脊、不写字。
        const unknown = card(page, 'card:playlist:p-unknown');
        if (await unknown.count()) {
            await expect(unknown.locator('.bravais-tile-spine')).toHaveCount(1);
            await expect(unknown.locator('.bravais-tile-spine span')).toHaveCount(0);
        }

        // 歌曲、私人 FM（直接播放的电台流）：满版海报，标签原位。
        const track = page.locator('.bravais-tile[data-library-entry="kinds-track-0"]').first();
        await expect(track).not.toHaveAttribute('data-bravais-form', /.*/);
        await expect(track.locator('.bravais-tile-spine, .bravais-tile-duo')).toHaveCount(0);
        expect(await leftWithinFace(track.locator('.lattice-poster-badge'))).toBe(14);
        const fm = card(page, 'card:radio:personal_fm');
        await expect(fm).not.toHaveAttribute('data-bravais-form', /.*/);
        await expect(fm.locator('.bravais-tile-spine')).toHaveCount(0);

        // 特殊集合的强调色标签同样右移让开书脊。
        const liked = card(page, 'card:playlist:liked');
        await expect(liked.locator('.lattice-poster-badge')).toHaveClass(/\bis-special\b/);
        expect(await leftWithinFace(liked.locator('.lattice-poster-badge'))).toBe(30);
        await expect(liked.locator('.bravais-tile-spine')).toHaveText('321 tracks');
        // 正在播放的强调色描边（z 4）压在书脊（z 3）上。
        expect(await style(spine, 'z-index')).toBe('3');
    });

    test('artists are duotone portraits that take their light from the photo and fall back to the accent', async ({ mount, page }) => {
        // Playwright 给拦截的跨源应答自动补 CORS 头；明确写一个别的来源，匿名请求就读不了像素（普通 <img> 照常显示）。
        await page.route('http://kinds-cors.localhost:4196/**', route => route.fulfill({
            contentType: 'image/png',
            headers: { 'access-control-allow-origin': 'http://elsewhere.invalid' },
            body: RED_PNG,
        }));
        await mountKinds(mount, page, { theme: 'vivid', mix: 'artists', current: 'none', extraArtistCover: CORS_BLOCKED_COVER });
        const artist = card(page, 'card:artist:r0');
        await expect(artist).toHaveAttribute('data-bravais-form', 'portrait');
        const duo = artist.locator('.bravais-tile-face > .bravais-tile-duo');
        await expect(duo).toHaveCount(1);
        // 取色是异步的：先画回退色，取到后写上 --bravais-duo-light（同源封面取得到）。
        await expect(duo).toHaveAttribute('data-bravais-tone', 'photo');
        expect(await duo.evaluate(node => (node as HTMLElement).style.getPropertyValue('--bravais-duo-light'))).toMatch(/^hsl\(\d+ 62% 66%\)$/);
        expect(await style(duo.locator('i'), 'mix-blend-mode')).toBe('multiply');
        expect(await style(duo, 'mix-blend-mode', '::after')).toBe('lighten');
        expect(await duoOpacity(artist)).toBe(1);
        // 名字放大约 1.3 倍、不显示副标题。
        expect(await style(artist.locator('.lattice-poster-copy small'), 'display')).toBe('none');
        const fontSize = Number.parseFloat(await style(artist.locator('.lattice-poster-copy strong'), 'font-size'));
        // 普通海报的标题字号 clamp(22px, 2vw, 36px)。
        const plain = await page.evaluate(() => Math.min(36, Math.max(22, window.innerWidth * 0.02)));
        expect(fontSize / plain).toBeCloseTo(1.3, 2);

        // 没有头像（人像层画在程序生成的渐变上）：亮端回退到主题强调色（彩色主题的 #fd5c47）。
        const accent = 'rgb(253, 92, 71)';
        const fallback = card(page, 'card:artist:no-cover').locator('.bravais-tile-duo');
        await expect(fallback).toHaveAttribute('data-bravais-tone', 'fallback');
        await expect.poll(() => style(fallback, 'background-color')).toBe(accent);
        await expect.poll(() => style(duo, 'background-color')).not.toBe(accent);
        // 图片能显示、但跨源没有 CORS 头（读不了像素）：照样是双色调，亮端回退到强调色。
        const blocked = card(page, 'card:artist:extra-cover').locator('.bravais-tile-duo');
        await expect(blocked).toHaveAttribute('data-bravais-tone', 'fallback');
        await expect.poll(() => style(blocked, 'background-color')).toBe(accent);
        // 头像地址本身加载不出来：不画人像层（与任何坏封面一样露出空卡底色），名字照样放大。
        const broken = card(page, 'card:artist:broken-cover');
        await expect(broken).toHaveAttribute('data-bravais-form', 'portrait');
        await expect(broken.locator('.bravais-tile-duo')).toHaveCount(0);
    });

    test('hover, keyboard focus and the playing card bring the portrait back to its own colours', async ({ mount, page }) => {
        await mountKinds(mount, page, { mix: 'artists', current: 'card:artist:r1', tint: 'on' });
        // 正在播放：双色调层淡出、不染色。
        const playing = page.locator('.bravais-tile[data-bravais-current]').first();
        await expect(playing).toHaveAttribute('data-library-card', 'card:artist:r1');
        await expect.poll(() => duoOpacity(playing)).toBe(0);
        await expect.poll(() => playing.locator('.lattice-poster-tint').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(0);

        // 悬停：恢复原色，移开后回到双色调。
        const slot = await visibleSlot(page, '.bravais-tile[data-bravais-form="portrait"]:not([data-bravais-current])');
        expect(slot).not.toBeNull();
        const hovered = tileAt(page, slot!);
        // 叠色画在双色调之上（双色调是内容层的第一层、没有 z-index；叠色 z 3）。
        await expect.poll(() => hovered.locator('.lattice-poster-tint').evaluate(node => Number(getComputedStyle(node).opacity))).toBeGreaterThan(0);
        expect(await hovered.locator('.bravais-tile-face').evaluate((face) => {
            const children = [...face.children];
            return children.indexOf(face.querySelector(':scope > .bravais-tile-duo')!) < children.indexOf(face.querySelector(':scope > .lattice-poster-tint')!);
        })).toBe(true);
        expect(await style(hovered.locator('.bravais-tile-duo'), 'z-index')).toBe('auto');
        await expect.poll(() => duoOpacity(hovered)).toBe(1);
        await hovered.locator('article').hover();
        await expect.poll(() => duoOpacity(hovered)).toBe(0);
        await page.mouse.move(2, 600);
        await expect.poll(() => duoOpacity(hovered)).toBe(1);

        // 键盘焦点（整面墙都是歌手，焦点落在哪张都是人像）。
        await page.locator('.bravais-field').focus();
        await page.keyboard.press('ArrowRight');
        const focused = page.locator('.bravais-tile[data-bravais-focused]');
        await expect(focused).toHaveCount(1);
        await expect(focused).toHaveAttribute('data-bravais-form', 'portrait');
        await expect.poll(() => duoOpacity(focused)).toBe(0);
    });

    test('lights out and the poster tint stack over the spine and the portrait in a fixed order', async ({ mount, page }) => {
        await mountKinds(mount, page, { lights: 'off', current: 'none' });
        await expect(stage(page)).toHaveClass(/\bis-lights-out\b/);
        const album = card(page, 'card:album:a0');
        const layers = await album.locator('.bravais-tile-face').evaluate((face) => {
            const z = (selector: string) => getComputedStyle(face.querySelector(selector)!).zIndex;
            return { spine: z(':scope > .bravais-tile-spine'), tint: z(':scope > .lattice-poster-tint'), lightsOut: z(':scope > .lattice-poster-lights-out') };
        });
        // 书脊与叠色同层（3）、排在叠色之后（叠色不染书脊），熄灯层（5）把它一起压暗。
        expect(layers).toEqual({ spine: '3', tint: '3', lightsOut: '5' });
        await expect.poll(() => album.locator('.lattice-poster-lights-out').evaluate(node => Number(getComputedStyle(node).opacity))).toBeCloseTo(0.82, 2);
        const artist = card(page, 'card:artist:r0');
        await expect.poll(() => artist.locator('.lattice-poster-lights-out').evaluate(node => Number(getComputedStyle(node).opacity))).toBeCloseTo(0.82, 2);
        // 书脊与双色调都在翻牌转的内容层里。
        await expect(page.locator('.bravais-tile > .bravais-tile-face > .bravais-tile-spine').first()).toBeAttached();
        await expect(page.locator('.bravais-tile > .bravais-tile-face > .bravais-tile-duo').first()).toBeAttached();
        await expect(page.locator('.bravais-tile > :not(.bravais-tile-face) .bravais-tile-spine, .bravais-tile > :not(.bravais-tile-face) .bravais-tile-duo')).toHaveCount(0);
    });

    test('the clear look degrades: no duotone, a shade spine that dims with the lights', async ({ mount, page }) => {
        await mountKinds(mount, page, { look: 'clear', lights: 'off', current: 'none' });
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'clear');
        const artist = card(page, 'card:artist:r0');
        await expect(artist).toHaveAttribute('data-bravais-see-through', 'true');
        await expect(artist).toHaveAttribute('data-bravais-form', 'portrait');
        await expect(artist.locator('.bravais-tile-duo')).toHaveCount(0);
        // 名字照样放大、不显示副标题。
        expect(await style(artist.locator('.lattice-poster-copy small'), 'display')).toBe('none');

        const album = card(page, 'card:album:a0');
        const spine = album.locator('.bravais-tile-spine');
        await expect(spine).toHaveText('12 tracks');
        // 不画封面：书脊里没有封面那一条，底色是遮罩色。
        await expect(spine.locator('i')).toHaveCount(0);
        expect(await style(spine, 'background-color')).toBe('rgba(0, 0, 0, 0.62)');
        // 熄灯：与标题、徽标同一条规则压到 0.28。
        await expect.poll(() => spine.evaluate(node => Number(getComputedStyle(node).opacity))).toBeCloseTo(0.28, 2);
        await expect.poll(() => album.locator('.lattice-poster-copy').evaluate(node => Number(getComputedStyle(node).opacity))).toBeCloseTo(0.28, 2);
    });
});

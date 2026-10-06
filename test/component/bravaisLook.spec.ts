import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/bravaisLook.spec.ts
// bravais 的透光（B6b③，设计稿 §11），挂真实的 Home（homeBehavior 探针）切到 bravais：
// - 部分透明（默认）：每块 k 个窗，窗不可点、方向键跳过，实色底板只在窗位挖洞；
// - 外观动作换窗数与循环三档：窗数跟着变，全透明时墙上只剩标题（聚焦卡照常有封面），实色档没有底板；
// - 聚焦卡让位期间局部底板顶上，落定后收起；
// - 拖动只改底板遮罩的位置，不重建遮罩、不重渲染磁贴。
// 探针里没有 visualizer，窗里露出的是页面底色；visualizer 的挂载 / 卸载在 e2e 的 bravaisVisualizerMount 里。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const plate = (page: Page) => page.locator('[data-bravais-plate]');
const livePlate = (page: Page) => page.locator('.bravais-plate.is-live');
const runChrome = (page: Page, id: string) => page.evaluate(actionId => window.__homeProbe!.runChrome(actionId), id);
const chromeAvailable = (page: Page) => page.evaluate(() => window.__homeProbe!.chrome()?.available ?? []);

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({
        contentType: 'text/javascript',
        body: buildServiceStubModule(),
    }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
};

/** 渲染完整（12 个 slot 都在 DOM 里）的块，各有几个窗。 */
const windowsPerRenderedBlock = (page: Page) => page.evaluate(() => {
    const blocks = new Map<string, { slots: number; windows: number }>();
    document.querySelectorAll<HTMLElement>('.bravais-tile[data-bravais-slot]').forEach((tile) => {
        const [column, row] = tile.dataset.bravaisSlot!.split(',');
        const block = blocks.get(`${column},${row}`) ?? { slots: 0, windows: 0 };
        block.slots += 1;
        if (tile.dataset.bravaisKind === 'window') block.windows += 1;
        blocks.set(`${column},${row}`, block);
    });
    return [...new Set([...blocks.values()].filter(block => block.slots === 12).map(block => block.windows))];
});

/** 一张完整在视口里、没被缝挡住的磁贴（按选择器挑）。 */
const visibleSlot = (page: Page, selector: string) => page.evaluate((query) => {
    const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
    const fits = (rect: DOMRect) => rect.left > 8 && rect.top > 8
        && rect.right < window.innerWidth - 8 && rect.bottom < window.innerHeight - 140
        && (!seamRect || seamRect.width < 1 || rect.right < seamRect.left - 4 || rect.left > seamRect.right + 4);
    const tile = [...document.querySelectorAll<HTMLElement>(query)].find(element => fits(element.getBoundingClientRect()));
    return tile?.dataset.bravaisSlot ?? null;
}, selector);

const tile = (page: Page, slotKey: string) => page.locator(`[data-bravais-slot="${slotKey}"]`);

/** 打开一张首页卡片，等集合层的曲目铺满墙。 */
const openCollection = async (page: Page) => {
    const slot = await visibleSlot(page, '.bravais-tile[data-library-card]');
    expect(slot).not.toBeNull();
    await tile(page, slot!).locator('article').click();
    await expect(stage(page)).not.toHaveAttribute('data-bravais-layer', 'home:playlist');
    await expect(page.locator('.bravais-tile[data-library-card]')).toHaveCount(0);
    await expect(page.locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
};

test.describe('[bravais] see-through wall', () => {
    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('the default partial look inserts three windows per block that cannot be focused', async ({ page }) => {
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'partial');
        await expect(stage(page)).toHaveClass(/is-see-through/);
        expect(await stage(page).evaluate(element => getComputedStyle(element).backgroundImage)).toBe('none');
        await expect.poll(() => windowsPerRenderedBlock(page)).toEqual([3]);
        // 底板：遮罩里有窗的 SVG（evenodd 路径），底色减去洞。
        await expect.poll(() => plate(page).evaluate(element => getComputedStyle(element).maskImage)).toContain('data:image/svg+xml');
        await expect(page.locator('.bravais-tile[data-bravais-kind="window"][data-library-card]')).toHaveCount(0);

        // 点窗：不聚焦、不展开、不打开下一层。
        const windowSlot = await visibleSlot(page, '.bravais-tile[data-bravais-kind="window"]');
        expect(windowSlot).not.toBeNull();
        await tile(page, windowSlot!).locator('article').click();
        await expect(page.locator('[data-bravais-focused]')).toHaveCount(0);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist');

        // 方向键在墙上走，永远不落在窗上。
        await page.locator('.bravais-field').focus();
        for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowRight']) {
            await page.keyboard.press(key);
            await expect(page.locator('[data-bravais-focused]')).toHaveCount(1);
            await expect(page.locator('[data-bravais-focused]')).not.toHaveAttribute('data-bravais-kind', 'window');
        }
    });

    test('chrome actions step the windows and cycle solid, partial and clear', async ({ page }) => {
        await expect.poll(() => chromeAvailable(page)).toEqual(expect.arrayContaining(['wall-look', 'more-windows', 'fewer-windows']));
        expect(await runChrome(page, 'more-windows')).toBe(true);
        await expect.poll(() => windowsPerRenderedBlock(page)).toEqual([4]);
        expect(await runChrome(page, 'fewer-windows')).toBe(true);
        expect(await runChrome(page, 'fewer-windows')).toBe(true);
        await expect.poll(() => windowsPerRenderedBlock(page)).toEqual([2]);

        // 全透明：墙上没有结构窗，内容磁贴只留标题与底条，底板在它们上面挖洞。
        expect(await runChrome(page, 'wall-look')).toBe(true);
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'clear');
        await expect.poll(() => windowsPerRenderedBlock(page)).toEqual([0]);
        await expect.poll(() => chromeAvailable(page)).not.toContain('more-windows');
        const seeThrough = page.locator('.bravais-tile[data-bravais-see-through] > article').first();
        await expect(seeThrough).toBeAttached();
        expect(await seeThrough.evaluate(element => element.style.backgroundImage)).toBe('');
        await expect(seeThrough.locator('.bravais-tile-strip')).toHaveCount(1);
        await expect(seeThrough.locator('.lattice-poster-copy strong')).toHaveCount(1);

        // 聚焦卡照常显示封面。
        await openCollection(page);
        const track = await visibleSlot(page, '.bravais-tile[data-library-entry]');
        await tile(page, track!).locator('article').click();
        await expect(tile(page, track!)).toHaveAttribute('data-bravais-expanded', 'true');
        await expect(tile(page, track!)).not.toHaveAttribute('data-bravais-see-through', /.*/);
        expect(await tile(page, track!).locator('article').first().evaluate(element => element.style.backgroundImage)).not.toBe('');

        // 实色：没有底板、没有窗，根节点画墙面。
        expect(await runChrome(page, 'wall-look')).toBe(true);
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'solid');
        await expect(plate(page)).toHaveCount(0);
        await expect(page.locator('.bravais-tile[data-bravais-see-through], .bravais-tile[data-bravais-kind="window"]')).toHaveCount(0);
        expect(await stage(page).evaluate(element => getComputedStyle(element).backgroundImage)).toContain('radial-gradient');
    });

    test('a live plate covers the focused block while it re-gears, then hands back to the main plate', async ({ page }) => {
        await openCollection(page);
        const track = await visibleSlot(page, '.bravais-tile[data-library-entry]');
        await tile(page, track!).locator('article').click();
        // 让位期间：局部底板顶上（块矩形减去窗的实时矩形），主底板在这一块上挖整块的洞。
        await expect(livePlate(page)).toHaveAttribute('data-bravais-live-plate', /^-?\d+,-?\d+$/);
        await expect(livePlate(page)).toBeVisible();
        const layers = await livePlate(page).evaluate(element => element.style.maskComposite.split(',').length);
        expect(layers).toBe(1 + 3);
        // 落定：局部底板收起。
        await expect(livePlate(page)).toBeHidden({ timeout: 3_000 });
        await expect(livePlate(page)).not.toHaveAttribute('data-bravais-live-plate', /.+/);
        await expect(tile(page, track!)).toHaveAttribute('data-bravais-expanded', 'true');
    });

    test('dragging only moves the plate mask, without rebuilding it or re-rendering tiles', async ({ page }) => {
        await expect.poll(() => plate(page).evaluate(element => element.style.maskPosition)).not.toBe('');
        const field = await page.locator('.bravais-field').boundingBox();
        const x = field!.x + field!.width * 0.25;
        const y = field!.y + field!.height * 0.4;
        /** 拖一段再停稳（末尾原地停几帧，松手时没有惯性）。 */
        const drag = async (fromX: number, fromY: number, dx: number, dy: number) => {
            await page.mouse.move(fromX, fromY);
            await page.mouse.down();
            for (let step = 1; step <= 12; step += 1) await page.mouse.move(fromX + (dx * step) / 12, fromY + (dy * step) / 12);
            for (let rest = 0; rest < 3; rest += 1) {
                await page.waitForTimeout(40);
                await page.mouse.move(fromX + dx, fromY + dy);
            }
            await page.mouse.up();
        };
        // 先拖一段让裁剪范围跟上（快到已渲染范围的边缘时会加挂整块，那时重建遮罩是预期的：可见块集合变了），
        // 再拖回来量：这一段在已裁剪的范围里，只该改遮罩位置。
        await drag(x, y, 72, 48);
        await page.waitForTimeout(300);
        await page.evaluate(() => { (window as Window & { __renderCounts?: Record<string, number> }).__renderCounts = {}; });
        const before = await plate(page).evaluate(element => ({ position: element.style.maskPosition, image: element.style.maskImage }));
        await drag(x + 72, y + 48, -72, -48);
        const after = await plate(page).evaluate(element => ({ position: element.style.maskPosition, image: element.style.maskImage }));
        expect(after.position).not.toBe(before.position);
        expect(after.image).toBe(before.image);
        const counts = await page.evaluate(() => (window as Window & { __renderCounts?: Record<string, number> }).__renderCounts ?? {});
        expect(counts.BravaisPlateMask ?? 0).toBe(0);
        expect(counts.BravaisTile ?? 0).toBe(0);
    });
});

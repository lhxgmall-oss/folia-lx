import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ProbeCallKind } from '../../dev/probes/libraryBehavior/probeLog';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/bravaisChrome.spec.ts
// 实测反馈 1 的组件用例（homeBehavior 探针 + setSuite('bravais')）：
// - Lattice 的墙面外观设置（灯光、叠色）作用到 bravais 根节点，三档透光下熄灯不涂黑窗；
// - 右下角共享工具按钮（components/wall/WallToolsButton）：点按打开面板、滑动打开命令面板、Esc 只收面板；
// - 左上角隐藏式返回（WallBackButton concealed）：热区 / 键盘聚焦出现，点了回到播放页，集合层上也在；
// - 聚焦卡：立即播放是纯图标按钮，「已在队列」悬停 / 聚焦时显示「插入队列」。
// 探针左下角的 DEV 浮层可能盖住磁贴，点磁贴用 article 的 click（磁贴都在屏幕中部）。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
const calls = (page: Page, kind: ProbeCallKind) => (
    page.evaluate(callKind => window.__homeProbe!.calls().filter(call => call.kind === callKind), kind)
);
const stack = (page: Page) => page.evaluate(() => window.__homeProbe!.stack());
const tools = (page: Page) => page.getByRole('button', { name: 'Wall tools', exact: true });
const panel = (page: Page) => page.getByRole('menu', { name: 'Wall tools', exact: true });
const back = (page: Page) => page.locator('[data-library-stage="bravais"] .lattice-back');
const opacityOf = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => Number(getComputedStyle(node).opacity));

/** 在 fixtures 的种子脚本之后再写几项存储（store 在模块 import 时读，必须在页面脚本之前落地）。 */
const seedStorage = (page: Page, entries: [string, string][]) => page.addInitScript(pairs => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
}, entries);

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
    await settled(page);
};

/** 一张此刻完整在视口中部、没被缝盖住的磁贴（slot key）。 */
const middleTile = (page: Page, attribute: 'data-library-card' | 'data-library-entry') => page.evaluate(name => {
    const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
    const fits = (rect: DOMRect) => rect.left > 200 && rect.top > 120
        && rect.right < window.innerWidth - 200 && rect.bottom < window.innerHeight - 200
        && (!seamRect || seamRect.width < 1 || rect.right < seamRect.left - 4 || rect.left > seamRect.right + 4);
    const tile = [...document.querySelectorAll<HTMLElement>(`.bravais-tile[${name}]`)]
        .find(element => fits(element.getBoundingClientRect()));
    return tile?.dataset.bravaisSlot ?? null;
}, attribute);

const tile = (page: Page, slotKey: string) => page.locator(`[data-bravais-slot="${slotKey}"]`);

/** 点开一张首页卡片，等集合层接管墙面、翻牌放完。 */
const openCard = async (page: Page) => {
    const slot = await middleTile(page, 'data-library-card');
    expect(slot).not.toBeNull();
    await tile(page, slot!).locator('article').click();
    await expect.poll(() => stack(page)).toHaveLength(1);
    await expect(page.locator('.bravais-tile[data-library-card]')).toHaveCount(0, { timeout: 10_000 });
    await settled(page);
};

/** 在集合层点开一首歌的聚焦卡，返回卡片与它的播放键。 */
const expandSong = async (page: Page) => {
    const slot = await middleTile(page, 'data-library-entry');
    expect(slot).not.toBeNull();
    await tile(page, slot!).locator('article').click();
    const card = page.locator('[data-bravais-expanded]');
    await expect(card).toHaveCount(1);
    const entry = (await card.getAttribute('data-library-entry'))!;
    return { card, playbackKey: entry.replace(/-\d+$/, '') };
};

test.describe('[bravais-only] wall chrome and shared appearance settings', () => {
    test('lights and poster tint from the Lattice settings land on the bravais root', async ({ mount, page }) => {
        await seedStorage(page, [
            ['library_wall_look', 'solid'],
            ['lattice_poster_tint_use_custom_color', 'true'],
            ['lattice_poster_tint_color', '#33aa66'],
            ['lattice_poster_tint_intensity', '0.3'],
        ]);
        await mountBravais(mount, page);
        const root = stage(page);
        await expect(root).toHaveClass(/\bhas-poster-tint\b/);
        await expect(root).toHaveClass(/\buses-custom-poster-tint\b/);
        await expect(root).not.toHaveClass(/\bis-lights-out\b/);
        expect(await root.evaluate(node => (node as HTMLElement).style.getPropertyValue('--lattice-poster-tint-color'))).toBe('#33aa66');
        expect(await root.evaluate(node => (node as HTMLElement).style.getPropertyValue('--lattice-poster-tint-intensity'))).toBe('0.3');
        // 叠色画在普通磁贴上（自定义颜色、强度 0.3）；熄灯层此刻不显示。
        await page.mouse.move(2, 600);
        const plainTile = '.bravais-tile:not(:hover) > .lattice-poster.bravais-tile-face:not(.is-current):not(.is-focused):not(.is-wall):not(.is-window)';
        expect(await page.locator(`${plainTile} .lattice-poster-tint`).first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(51, 170, 102)');
        await expect.poll(() => opacityOf(page, `${plainTile} .lattice-poster-tint`)).toBeCloseTo(0.3, 2);
        await expect.poll(() => opacityOf(page, `${plainTile} .lattice-poster-lights-out`)).toBe(0);

        // 面板里关灯、关叠色：写的是 Lattice 的同一个 store（同一份存储），根节点的 class 跟着变。
        await tools(page).click();
        await panel(page).getByRole('menuitemcheckbox', { name: 'Poster lighting', exact: true }).click();
        await expect(root).toHaveClass(/\bis-lights-out\b/);
        await expect.poll(() => opacityOf(page, `${plainTile} .lattice-poster-lights-out`)).toBeCloseTo(0.82, 2);
        // 熄灯时叠色归零（与 Lattice 相同），不叠两层。
        await expect.poll(() => opacityOf(page, `${plainTile} .lattice-poster-tint`)).toBe(0);
        await panel(page).getByRole('menuitemcheckbox', { name: 'Poster focus tint', exact: true }).click();
        await expect(root).not.toHaveClass(/\bhas-poster-tint\b/);
        expect(await page.evaluate(() => [localStorage.getItem('lattice_lights_on'), localStorage.getItem('lattice_poster_tint_enabled')]))
            .toEqual(['false', 'false']);
    });

    test('lights out never paints the windows: partial windows have no layer, clear tiles only dim their text', async ({ mount, page }) => {
        await seedStorage(page, [['lattice_lights_on', 'false'], ['library_wall_look', 'partial']]);
        await mountBravais(mount, page);
        await expect(stage(page)).toHaveClass(/\bis-lights-out\b/);
        await page.mouse.move(2, 600);
        // 部分透明：窗没有内容，也就没有熄灯层；内容磁贴照常熄灯。
        await expect(page.locator('.bravais-tile[data-bravais-kind="window"]').first()).toBeAttached();
        await expect(page.locator('.bravais-tile[data-bravais-kind="window"] .lattice-poster-lights-out')).toHaveCount(0);
        const plainTile = '.bravais-tile:not(:hover) > .lattice-poster.bravais-tile-face:not(.is-current):not(.is-focused):not(.is-wall):not(.is-window)';
        await expect.poll(() => opacityOf(page, `${plainTile} .lattice-poster-lights-out`)).toBeCloseTo(0.82, 2);

        // 全透明：内容磁贴本身是窗，熄灯层不显示，只压暗标题。
        await page.evaluate(() => window.__homeProbe!.runChrome('wall-look'));
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'clear');
        await settled(page);
        const seeThrough = '.bravais-tile:not(:hover) > .lattice-poster.is-see-through:not(.is-current):not(.is-focused)';
        await expect(page.locator(seeThrough).first()).toBeAttached();
        await expect.poll(() => opacityOf(page, `${seeThrough} .lattice-poster-lights-out`)).toBe(0);
        await expect.poll(() => opacityOf(page, `${seeThrough} > .lattice-poster-copy`)).toBeCloseTo(0.28, 2);
    });

    test('the tools button opens its panel, the slide opens the command palette, Escape only closes the panel', async ({ mount, page }) => {
        await seedStorage(page, [['library_wall_look', 'partial']]);
        await mountBravais(mount, page);
        await tools(page).click();
        const menu = panel(page);
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Locate the playing song', exact: true })).toBeVisible();
        await expect(menu.getByRole('menuitemcheckbox', { name: 'Poster lighting', exact: true })).toBeChecked();
        await expect(menu.getByRole('menuitemcheckbox', { name: 'Poster focus tint', exact: true })).toBeChecked();

        // 透光：点一下换下一档，面板不收起，墙跟着换档。
        const look = menu.getByRole('menuitem', { name: /^Wall transparency/ });
        await expect(look).toContainText('Partly see-through');
        await look.click();
        await expect(menu).toBeVisible();
        await expect(look).toContainText('See-through');
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'clear');

        // 帮助：每行一件事——左边一个说明、右边一个按键，内容是 bravais 实际的键位（bravaisHelp，单测核对键位规则）。
        await menu.getByRole('menuitem', { name: 'Operation guide', exact: true }).click();
        const help = menu.getByRole('note');
        await expect(help).toBeVisible();
        const rows = await help.locator('li').evaluateAll(items => items.map(item => ({
            children: [...item.children].map(child => child.tagName.toLowerCase()),
            label: item.querySelector(':scope > span')?.textContent ?? '',
            key: item.querySelector(':scope > kbd')?.textContent ?? '',
        })));
        expect(rows.map(row => row.children)).toEqual(Array.from({ length: 11 }, () => ['span', 'kbd']));
        expect(rows.map(row => [row.label, row.key])).toEqual([
            ['Type to filter this page', 'A–Z'],
            ['Search online platforms (home)', '/'],
            ['Move the focus', '↑ ↓ ← →'],
            ['Open a song card or a collection', 'Enter'],
            ['Play the song in the open card', 'Enter'],
            ['Add the focused song to the queue', 'Shift + Enter'],
            ['Step back one level', 'ESC'],
            ['Move between the wall and the info strip', 'Tab'],
            ['Switch the home tabs', 'F6'],
            ['Locate the playing song', ': + C'],
            ['Open the command palette', 'Ctrl + K'],
        ]);

        // 在集合层上按 Esc：只收起面板，不退层。
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await openCard(page);
        await tools(page).click();
        await expect(panel(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panel(page)).toHaveCount(0);
        expect(await stack(page)).toHaveLength(1);

        // 向左滑：打开命令面板（根列表），不打开工具面板。
        const before = await page.evaluate(() => window.__homeProbe!.paletteRequest().seq);
        const box = (await tools(page).boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 1; step <= 6; step++) await page.mouse.move(x - step * 9, y);
        await page.mouse.up();
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.paletteRequest())).toEqual({ seq: before + 1, kind: 'root' });
        await expect(panel(page)).toHaveCount(0);
    });

    test('the hidden back button shows in the top-left corner or on keyboard focus and returns to the player', async ({ mount, page }) => {
        await mountBravais(mount, page);
        const button = back(page);
        await expect(button).toHaveAccessibleName('Back to the player');
        await page.mouse.move(700, 500);
        await expect.poll(() => button.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(0);
        await expect(button).not.toHaveClass(/\bis-revealed\b/);

        // 鼠标进左上角热区：出现，点了回到播放页。
        await page.mouse.move(60, 60);
        await expect(button).toHaveClass(/\bis-revealed\b/);
        await expect.poll(() => button.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
        await button.click();
        await expect.poll(async () => (await calls(page, 'backToPlayer')).length).toBe(1);

        // 离开热区就藏起来；键盘聚焦时出现（可聚焦）。
        await page.mouse.move(700, 500);
        await expect(button).not.toHaveClass(/\bis-revealed\b/);
        await page.keyboard.press('Shift');
        await button.focus();
        await expect(button).toBeFocused();
        await expect.poll(() => button.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await calls(page, 'backToPlayer')).length).toBe(2);

        // 集合层上也在，语义仍是回到播放页（不是缝里 ‹ 的层返回）。
        await openCard(page);
        await page.mouse.move(700, 500);
        await page.mouse.move(60, 60);
        await expect(button).toHaveClass(/\bis-revealed\b/);
        await button.click();
        await expect.poll(async () => (await calls(page, 'backToPlayer')).length).toBe(3);
        expect(await stack(page)).toHaveLength(1);
    });

    test('the focus card plays from an icon-only button and offers insert-into-queue on a queued song', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await openCard(page);
        const { card, playbackKey } = await expandSong(page);

        const play = card.locator('[data-bravais-action="play"]');
        await expect(play).toHaveAccessibleName('Play now');
        await expect(play).toHaveAttribute('title', 'Play now');
        expect((await play.innerText()).trim()).toBe('');

        const enqueue = card.locator('[data-bravais-action="enqueue"]');
        await expect(enqueue).toHaveAccessibleName('Add to queue');

        // 已在队列：静止时「已在队列」，悬停 / 键盘聚焦时「插入队列」，点了仍交给入队（应用按入队规则挪位置）。
        await page.evaluate(key => window.__homeProbe!.setPlayQueue([key]), playbackKey);
        await expect(enqueue).toHaveAttribute('data-bravais-queued', 'true');
        await page.mouse.move(2, 600);
        await expect(enqueue).toHaveAccessibleName('In queue');
        await expect(enqueue.locator('.bravais-enqueue-hover')).toBeHidden();

        await enqueue.hover();
        await expect(enqueue.locator('.bravais-enqueue-hover')).toBeVisible();
        await expect(enqueue.locator('.bravais-enqueue-rest')).toBeHidden();
        await expect(enqueue).toHaveAccessibleName('Insert into queue');

        await page.mouse.move(2, 600);
        await expect(enqueue.locator('.bravais-enqueue-rest')).toBeVisible();
        await page.keyboard.press('Shift');
        await enqueue.focus();
        await expect(enqueue.locator('.bravais-enqueue-hover')).toBeVisible();

        await page.evaluate(() => window.__homeProbe!.clearLog());
        await enqueue.dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'addSongToQueue')).map(call => call.ids[0])).toEqual([playbackKey]);
    });
});
